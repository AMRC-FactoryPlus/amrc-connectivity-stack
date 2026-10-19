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
-module(krb_proto_tcp_fsm).
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
    connect/3,
    connect_delay/3,
    idle/3,
    retry/3,
    err/3,
    err_connect/3,
    ping/3
    ]).

-type realm() :: string().
-type tcpport() :: integer().
-type hostname() :: inet:hostname().
-type msecs() :: integer().
-type retry_config() :: #{
    retries => integer(), timeout => msecs(), delay => msecs(),
    max_timeout => msecs(), max_delay => msecs(), ping_timeout => msecs()
    }.

-spec start_link(pid(), realm(), hostname(), tcpport(), retry_config()) -> {ok, pid()}.
start_link(ClientFSM, Realm, Host, Port, RConfig) ->
    gen_statem:start_link(?MODULE, [ClientFSM, Realm, Host, Port, RConfig], []).

-record(?MODULE, {
    realm :: string(),
    cfsm :: pid(),
    host :: hostname(),
    port :: tcpport(),
    config :: retry_config(),
    ping_timeout :: msecs(),
    timeout :: msecs(),
    delay :: msecs(),
    retries :: integer(),
    tsock :: gen_tdp:socket() | undefined,
    sendref :: undefined | reference(),
    pkt :: undefined | binary(),
    expect = [] :: [atom()]
    }).

-define(tcp_options, [
    {active, true},
    binary,
    {packet, 4},
    {nodelay, true},
    {keepalive, true}
    ]).

init([ClientFSM, Realm, Host, Port, RConfig]) ->
    #{retries := Retries, timeout := Timeout, delay := Delay} = RConfig,
    Ping = case RConfig of
        #{ping_timeout := P} -> P;
        _ -> 30000
    end,
    S0 = #?MODULE{cfsm = ClientFSM, realm = Realm, host = Host, port = Port,
        config = RConfig, timeout = Timeout, retries = Retries, delay = Delay,
        ping_timeout = Ping},
    {ok, connect, S0}.

terminate(Why, State, #?MODULE{tsock = undefined}) ->
    lager:debug("terminating from ~p due to ~p", [State, Why]),
    ok;
terminate(Why, State, S0 = #?MODULE{tsock = Sock}) ->
    gen_tcp:close(Sock),
    terminate(Why, State, S0#?MODULE{tsock = undefined}).

callback_mode() -> [state_functions, state_enter].

reset_retries(S0 = #?MODULE{config = RConfig}) ->
    #{retries := R0, timeout := T0, delay := D0} = RConfig,
    S0#?MODULE{retries = R0, timeout = T0, delay = D0}.

incr_retry(S0 = #?MODULE{config = RConfig, retries = R0, timeout = T0,
                         delay = D0}) ->
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

connect({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
connect(enter, _PrevState, _S0 = #?MODULE{retries = 0, host = H}) ->
    lager:debug("[~p] out of tcp retries", [H]),
    {keep_state_and_data, [{state_timeout, 0, err}]};
connect(enter, _PrevState, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [{state_timeout, 0, connect}]};
connect(state_timeout, err, S0 = #?MODULE{}) ->
    {next_state, err, S0};
connect(state_timeout, connect, S0 = #?MODULE{host = H, port = P,
                                              timeout = T0}) ->
    case gen_tcp:connect(H, P, ?tcp_options, T0) of
        {ok, Sock} ->
            S1 = S0#?MODULE{tsock = Sock},
            case S1 of
                #?MODULE{sendref = undefined} ->
                    {next_state, idle, reset_retries(S1)};
                _ ->
                    {next_state, retry, reset_retries(S1)}
            end;
        {error, _} ->
            {next_state, connect_delay, S0}
    end.

connect_delay({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
connect_delay(enter, _PrevState, S0 = #?MODULE{delay = D0}) ->
    {keep_state, S0, [{state_timeout, D0, none}]};
connect_delay(info, {timeout, _, inet}, #?MODULE{}) ->
    lager:debug("ignoring bogus inet timeout!"),
    keep_state_and_data;
connect_delay(state_timeout, _, S0 = #?MODULE{}) ->
    {next_state, connect, incr_retry(S0)}.

idle(enter, _PrevState, S0 = #?MODULE{cfsm = FSM, ping_timeout = Ping}) ->
    case is_process_alive(FSM) of
        true ->
            {keep_state, S0, [{state_timeout, Ping, none}]};
        false ->
            {stop, normal, S0}
    end;
idle(info, {timeout, _, inet}, #?MODULE{}) ->
    lager:debug("ignoring bogus inet timeout!"),
    keep_state_and_data;
idle(info, {tcp, Sock, Data}, _S0 = #?MODULE{tsock = Sock}) ->
    lager:debug("got unsolicited data:~p (~B bytes)", [byte_size(Data)]),
    keep_state_and_data;
idle(info, {tcp_error, Sock, Why}, S0 = #?MODULE{host = H, tsock = Sock}) ->
    lager:debug("[~p] got tcp error: ~p", [H, Why]),
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect_delay, S1};
idle(info, {tcp_closed, Sock}, S0 = #?MODULE{tsock = Sock}) ->
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect, S1};
idle({call, From}, {send, Type, Msg, Expect}, S0 = #?MODULE{}) ->
    {ok, Bytes} = krb_proto:encode(Type, Msg),
    Ref = make_ref(),
    gen_statem:reply(From, {ok, Ref}),
    S1 = reset_retries(S0#?MODULE{expect = Expect, pkt = Bytes, sendref = Ref}),
    {next_state, retry, S1};
idle(state_timeout, _, S0 = #?MODULE{}) ->
    {next_state, ping, S0}.

retry({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
retry(enter, _PrevState, S0 = #?MODULE{retries = 0, host = H}) ->
    lager:debug("[~p] out of tcp retries", [H]),
    {keep_state, S0, [{state_timeout, 0, err}]};
retry(state_timeout, err, S0 = #?MODULE{}) ->
    {next_state, err, S0};
retry(enter, _PrevState, S0 = #?MODULE{tsock = Sock, pkt = Bytes,
                                       timeout = T0}) ->
    R = gen_tcp:send(Sock, Bytes),
    case R of
        ok ->
            {keep_state, S0, [{state_timeout, T0, send}]};
        {error, _} ->
            gen_tcp:close(Sock),
            S1 = S0#?MODULE{tsock = undefined},
            {keep_state, S1, [{state_timeout, 0, cdelay}]}
    end;
retry(state_timeout, cdelay, S0 = #?MODULE{}) ->
    {next_state, connect_delay, S0};
retry(state_timeout, send, S0 = #?MODULE{tsock = Sock}) ->
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect, S1};
retry(info, {tcp_error, Sock, Why}, S0 = #?MODULE{host = H, tsock = Sock}) ->
    lager:debug("[~p] got tcp error: ~p", [H, Why]),
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect_delay, S1};
retry(info, {tcp_closed, Sock}, S0 = #?MODULE{tsock = Sock}) ->
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect_delay, S1};
retry(info, {timeout, _, inet}, #?MODULE{}) ->
    lager:debug("ignoring bogus inet timeout!"),
    keep_state_and_data;
retry(info, {tcp, Sock, Data}, S0 = #?MODULE{tsock = Sock, cfsm = ClientFSM,
                                             host = H, expect = Es,
                                             sendref = Ref}) ->
    case krb_proto:decode(Data, Es) of
        {ok, Msg} ->
            ClientFSM ! {krb_reply, Ref, Msg},
            S1 = S0#?MODULE{pkt = undefined, expect = [], sendref = undefined},
            {next_state, idle, S1};
        {error, not_decoded} ->
            lager:debug("[~p] got unparseable response, retrying",
                [H]),
            gen_tcp:close(Sock),
            S1 = S0#?MODULE{tsock = undefined},
            {next_state, connect, S1}
    end.

err({call, From}, _Msg, _S0 = #?MODULE{}) ->
    gen_statem:reply(From, {error, short_circuit}),
    keep_state_and_data;
err(enter, _PrevState, S0 = #?MODULE{sendref = undefined, delay = D0, cfsm = FSM}) ->
    case is_process_alive(FSM) of
        true ->
            {keep_state, S0, [{state_timeout, D0, retry}]};
        false ->
            {stop, normal, S0}
    end;
err(info, {timeout, _, inet}, #?MODULE{}) ->
    lager:debug("ignoring bogus inet timeout!"),
    keep_state_and_data;
err(state_timeout, retry, S0 = #?MODULE{}) ->
    {next_state, err_connect, S0#?MODULE{}};
err(enter, PrevState, S0 = #?MODULE{sendref = Ref, cfsm = ClientFSM}) ->
    ClientFSM ! {krb_error, Ref},
    S1 = S0#?MODULE{sendref = undefined, pkt = undefined, expect = []},
    err(enter, PrevState, S1).

err_connect({call, From}, _Msg, _S0 = #?MODULE{}) ->
    gen_statem:reply(From, {error, short_circuit}),
    keep_state_and_data;
err_connect(enter, _PrevState, S0 = #?MODULE{cfsm = FSM}) ->
    case is_process_alive(FSM) of
        true ->
            {keep_state_and_data, [{state_timeout, 0, connect}]};
        false ->
            {stop, normal, S0}
    end;
err_connect(info, {timeout, _, inet}, #?MODULE{}) ->
    lager:debug("ignoring bogus inet timeout!"),
    keep_state_and_data;
err_connect(state_timeout, connect, S0 = #?MODULE{host = H, port = P,
                                                  timeout = T0}) ->
    case gen_tcp:connect(H, P, ?tcp_options, T0) of
        {ok, Sock} ->
            lager:debug("[~p] got connection, leaving err state", [H]),
            S1 = S0#?MODULE{tsock = Sock},
            {next_state, idle, reset_retries(S1)};
        {error, _} ->
            {next_state, err, S0}
    end.
    
ping({call, _From}, _Msg, _S0 = #?MODULE{}) ->
    {keep_state_and_data, [postpone]};
ping(enter, _PrevState, S0 = #?MODULE{tsock = Sock, ping_timeout = T0,
                                      realm = Realm}) ->
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
    R = gen_tcp:send(Sock, <<Bytes/binary>>),
    case R of
        ok ->
            {keep_state, S0, [{state_timeout, T0, none}]};
        {error, _} ->
            gen_tcp:close(Sock),
            S1 = S0#?MODULE{tsock = undefined},
            {next_state, connect_delay, S1}
    end;
ping(state_timeout, _, S0 = #?MODULE{tsock = Sock, host = H}) ->
    lager:debug("[~p] ping timeout", [H]),
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect_delay, S1};
ping(info, {tcp_error, Sock, Why}, S0 = #?MODULE{host = H, tsock = Sock}) ->
    lager:debug("[~p] got tcp error: ~p", [H, Why]),
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect_delay, S1};
ping(info, {tcp_closed, Sock}, S0 = #?MODULE{tsock = Sock, host = H}) ->
    lager:debug("[~p] closed cleanly after ping", [H]),
    gen_tcp:close(Sock),
    S1 = S0#?MODULE{tsock = undefined},
    {next_state, connect, S1};
ping(info, {tcp, Sock, Data}, S0 = #?MODULE{tsock = Sock, host = H}) ->
    case krb_proto:decode(Data, ['AS-REP', 'KRB-ERROR']) of
        {ok, _Msg} ->
            {next_state, idle, S0};
        {error, not_decoded} ->
            lager:debug("[~p] got unparseable response to ping", [H]),
            gen_tcp:close(Sock),
            S1 = S0#?MODULE{tsock = undefined},
            {next_state, connect_delay, S1}
    end.
