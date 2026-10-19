%% kerlberos
%%
%% Copyright 2021 Alex Wilson <alex@uq.edu.au>
%% The University of Queensland
%% All rights reserved.
%%
%% Redistribution and use in source and binary forms, with or without
%% modification, are permitted provided that the following conditions
%% are met:
%% 1. Redistributions of source code must retain the above copyright
%%    notice, this list of conditions and the following disclaimer.
%% 2. Redistributions in binary form must reproduce the above copyright
%%    notice, this list of conditions and the following disclaimer in the
%%    documentation and/or other materials provided with the distribution.
%%
%% THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
%% IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
%% OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
%% IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
%% INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
%% NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
%% DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
%% THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
%% (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
%% THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
%%

%% @private
-module(krb_proto_udp_fsm).
-behaviour(gen_statem).

-compile([{parse_transform, lager_transform}]).

-include("KRB5.hrl").

-export([
    start_link/5
    ]).

-export([
    init/1,
    callback_mode/0,
    terminate/3,
    idle/3,
    retry/3,
    delay/3,
    err/3,
    err_delay/3,
    ping/3
    ]).

-type realm() :: string().
-type udpport() :: integer().
-type hostname() :: inet:hostname().
-type msecs() :: integer().
-type retry_config() :: #{
    retries => integer(), timeout => msecs(), delay => msecs(),
    max_timeout => msecs(), max_delay => msecs(), ping_timeout => msecs()
    }.

-spec start_link(pid(), realm(), hostname(), udpport(), retry_config()) -> {ok, pid()}.
start_link(ClientFSM, Realm, Host, Port, RConfig) ->
    gen_statem:start_link(?MODULE, [ClientFSM, Realm, Host, Port, RConfig], []).

-record(?MODULE, {
    realm :: string(),
    cfsm :: pid(),
    host :: hostname(),
    port :: udpport(),
    config :: retry_config(),
    timeout :: msecs(),
    delay :: msecs(),
    retries :: integer(),
    usock :: gen_udp:socket() | undefined,
    pkt :: undefined | binary(),
    expect = [] :: [atom()],
    sendref :: undefined | reference(),
    ping :: msecs(),
    firstping = false :: boolean()
    }).

-define(udp_options, [binary, {active, true}]).

init([ClientFSM, Realm, Host, Port, RConfig]) ->
    #{retries := Retries, timeout := Timeout, delay := Delay} = RConfig,
    Ping = maps:get(ping_timeout, RConfig, 60000),
    S0 = #?MODULE{cfsm = ClientFSM, realm = Realm, host = Host, port = Port,
        config = RConfig, timeout = Timeout, retries = Retries, delay = Delay,
        ping = Ping},
    {ok, USock} = gen_udp:open(0, ?udp_options),
    S1 = S0#?MODULE{usock = USock},
    {ok, idle, S1}.

terminate(Why, State, #?MODULE{usock = undefined}) ->
    lager:debug("terminating from ~p due to ~p", [State, Why]),
    ok;
terminate(Why, State, S0 = #?MODULE{usock = Sock}) ->
    gen_udp:close(Sock),
    terminate(Why, State, S0#?MODULE{usock = undefined}).

callback_mode() -> [state_functions, state_enter].

reset_retries(S0 = #?MODULE{config = RConfig}) ->
    #{retries := R0, timeout := T0, delay := D0} = RConfig,
    S0#?MODULE{retries = R0, timeout = T0, delay = D0}.

incr_retry(S0 = #?MODULE{config = RConfig, retries = R0, timeout = T0, delay = D0}) ->
    R1 = R0 - 1,
    T1 = T0 * 2,
    D1 = D0 * 2,
    T2 = case RConfig of
        #{max_timeout := MT} when (MT =< T1) -> MT;
        _ -> T1
    end,
    D2 = case RConfig of
        #{max_delay := MD} when (MD =< D1) -> MD;
        _ -> D1
    end,
    S0#?MODULE{retries = R1, timeout = T2, delay = D2}.

idle(enter, _PrevState, S0 = #?MODULE{firstping = false}) ->
    {keep_state, S0, [{state_timeout, 0, ping}]};
idle(enter, _PrevState, S0 = #?MODULE{ping = Ping}) ->
    {keep_state, S0, [{state_timeout, Ping, ping}]};
idle(state_timeout, ping, S0 = #?MODULE{}) ->
    {next_state, ping, S0};
idle(info, {udp, Sock, IP, Port, Data}, _S0 = #?MODULE{usock = Sock}) ->
    lager:debug("unsolicited udp packet from ~p:~p (~B bytes)",
        [IP, Port, byte_size(Data)]),
    keep_state_and_data;
idle({call, From}, {send, Type, Msg, Expect}, S0 = #?MODULE{}) ->
    {ok, Bytes} = krb_proto:encode(Type, Msg),
    Ref = make_ref(),
    gen_statem:reply(From, {ok, Ref}),
    S1 = reset_retries(S0#?MODULE{expect = Expect, pkt = Bytes, sendref = Ref}),
    {next_state, retry, S1}.

retry({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
retry(enter, _PrevState, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [{state_timeout, 0, entry}]};
retry(state_timeout, entry, S0 = #?MODULE{retries = 0, host = H}) ->
    lager:debug("[~p] out of udp retries", [H]),
    {next_state, err, S0};
retry(state_timeout, entry, S0 = #?MODULE{usock = Sock, host = H, port = P,
                                          pkt = Bytes, timeout = T0}) ->
    case gen_udp:send(Sock, H, P, Bytes) of
        ok ->
            {keep_state, S0, [{state_timeout, T0, limit}]};
        {error, Why} ->
            lager:debug("[~p] error during send: ~p", [H, Why]),
            {next_state, delay, S0}
    end;
retry(state_timeout, limit, S0 = #?MODULE{}) ->
    {next_state, delay, S0};
retry(info, {udp, Sock, _IP, Port, Data}, S0 = #?MODULE{usock = Sock,
                                                        cfsm = ClientFSM,
                                                        host = H,
                                                        port = Port,
                                                        expect = Es,
                                                        sendref = Ref}) ->
    case krb_proto:decode(Data, Es) of
        {ok, Msg} ->
            case Ref of
                undefined -> ok;
                _ -> ClientFSM ! {krb_reply, Ref, Msg}
            end,
            S1 = S0#?MODULE{pkt = undefined, expect = [], sendref = undefined},
            {next_state, idle, S1};
        {error, not_decoded} ->
            lager:debug("[~p] got unparseable response, retrying", [H]),
            {next_state, delay, S0}
    end.

delay({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
delay(info, {udp, Sock, IP, Port, Data}, _S0 = #?MODULE{usock = Sock}) ->
    lager:debug("unsolicited udp packet from ~p:~p (~B bytes)",
        [IP, Port, byte_size(Data)]),
    keep_state_and_data;
delay(enter, _PrevState, S0 = #?MODULE{delay = D0}) ->
    {keep_state, S0, [{state_timeout, D0, limit}]};
delay(state_timeout, limit, S0 = #?MODULE{}) ->
    {next_state, retry, incr_retry(S0)}.

err({call, From}, _Msg, _S0 = #?MODULE{}) ->
    gen_statem:reply(From, {error, short_circuit}),
    keep_state_and_data;
err(enter, _PrevState, S0 = #?MODULE{}) ->
    {keep_state, S0, [{state_timeout, 0, entry}]};
err(state_timeout, entry, S0 = #?MODULE{realm = Realm, usock = Sock,
                                        host = H, port = P, timeout = T0,
                                        sendref = undefined}) ->
    Options = sets:from_list([renewable,proxiable,forwardable]),
    ReqBody = #'KDC-REQ-BODY'{
        'kdc-options' = krb_proto:encode_kdc_flags(Options),
        cname = #'PrincipalName'{
            'name-type' = 11,
            'name-string' = ["WELLKNOWN", "ANONYMOUS"]},
        sname = #'PrincipalName'{
            'name-type' = 2,
            'name-string' = ["krbtgt", Realm]},
        realm = Realm,
        till = krb_proto:system_time_to_krbtime(
            erlang:system_time(second) + 4*3600, second),
        nonce = rand:uniform(1 bsl 30),
        etype = [des_crc]
    },
    Req = #'KDC-REQ'{
        pvno = 5,
        'msg-type' = 10,
        padata = [],
        'req-body' = ReqBody
    },
    {ok, Bytes} = krb_proto:encode('AS-REQ', Req),
    case gen_udp:send(Sock, H, P, Bytes) of
        ok ->
            {keep_state, S0, [{state_timeout, T0, limit}]};
        {error, _} ->
            gen_udp:close(Sock),
            {ok, Sock1} = gen_udp:open(0, ?udp_options),
            S1 = S0#?MODULE{usock = Sock1},
            {next_state, err_delay, S1}
    end;
err(state_timeout, entry, S0 = #?MODULE{sendref = Ref, cfsm = ClientFSM}) ->
    ClientFSM ! {krb_error, Ref},
    S1 = S0#?MODULE{sendref = undefined, pkt = undefined, expect = []},
    err(state_timeout, entry, S1);
err(state_timeout, limit, S0 = #?MODULE{usock = Sock0}) ->
    gen_udp:close(Sock0),
    {ok, Sock1} = gen_udp:open(0, ?udp_options),
    S1 = S0#?MODULE{usock = Sock1},
    {next_state, err_delay, S1};
err(info, {udp, Sock, _IP, Port, Data}, S0 = #?MODULE{usock = Sock, host = H,
                                                      port = Port}) ->
    case krb_proto:decode(Data, ['AS-REP', 'KRB-ERROR']) of
        {ok, _Msg} ->
            S1 = S0#?MODULE{pkt = undefined, expect = [], sendref = undefined},
            {next_state, idle, S1};
        {error, not_decoded} ->
            lager:debug("[~p] got unparseable response, retrying", [H]),
            {next_state, err_delay, S0}
    end.

err_delay({call, From}, _Msg, _S0 = #?MODULE{}) ->
    gen_statem:reply(From, {error, short_circuit}),
    keep_state_and_data;
err_delay(info, {udp, Sock, IP, Port, Data}, _S0 = #?MODULE{usock = Sock}) ->
    lager:debug("unsolicited udp packet from ~p:~p (~B bytes)",
        [IP, Port, byte_size(Data)]),
    keep_state_and_data;
err_delay(enter, _PrevState, S0 = #?MODULE{delay = D0}) ->
    {keep_state, S0, [{state_timeout, D0, limit}]};
err_delay(state_timeout, limit, S0 = #?MODULE{}) ->
    {next_state, err, S0}.

ping({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
ping(enter, _PrevState, S0 = #?MODULE{}) ->
    {keep_state, S0, [{state_timeout, 0, send}]};
ping(state_timeout, send, S0 = #?MODULE{realm = Realm}) ->
    Options = sets:from_list([renewable,proxiable,forwardable]),
    ReqBody = #'KDC-REQ-BODY'{
        'kdc-options' = krb_proto:encode_kdc_flags(Options),
        cname = #'PrincipalName'{
            'name-type' = 11,
            'name-string' = ["WELLKNOWN", "ANONYMOUS"]},
        sname = #'PrincipalName'{
            'name-type' = 2,
            'name-string' = ["krbtgt", Realm]},
        realm = Realm,
        till = krb_proto:system_time_to_krbtime(
            erlang:system_time(second) + 4*3600, second),
        nonce = rand:uniform(1 bsl 30),
        etype = [des_crc]
    },
    Req = #'KDC-REQ'{
        pvno = 5,
        'msg-type' = 10,
        padata = [],
        'req-body' = ReqBody
    },
    {ok, Bytes} = krb_proto:encode('AS-REQ', Req),
    S1 = reset_retries(S0#?MODULE{expect = ['AS-REP', 'KRB-ERROR'],
                                  pkt = Bytes,
                                  sendref = undefined,
                                  firstping = true}),
    {next_state, retry, S1}.

