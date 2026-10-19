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
-module(krb_req_fsm).
-behaviour(gen_statem).

-include("KRB5.hrl").

-compile([{parse_transform, lager_transform}]).

-export([
    start_link/4,
    await/1,
    start_link_and_await/4
    ]).

-export([
    init/1,
    callback_mode/0,
    terminate/3,
    tcp/3,
    udp_single/3,
    udp_multi/3,
    done/3,
    wait/3
    ]).

-spec start_link_and_await(Type :: atom(), Msg :: term(), Expect :: [atom()], ProtoFSM :: pid()) -> {ok, term()} | {error, term()}.
start_link_and_await(Type, Msg, Expect, ProtoFSM) ->
    {ok, Pid} = start_link(Type, Msg, Expect, ProtoFSM),
    await(Pid).

-spec start_link(Type :: atom(), Msg :: term(), Expect :: [atom()], ProtoFSM :: pid()) -> {ok, pid()}.
start_link(Type, Msg, Expect, ProtoFSM) ->
    gen_statem:start_link(?MODULE, [Type, Msg, Expect, ProtoFSM], []).

-spec await(pid()) -> {ok, term()} | {error, term()}.
await(Pid) ->
    gen_statem:call(Pid, await).

-record(?MODULE, {
    type :: atom(),
    msg :: term(),
    expect :: [atom()],
    proto :: pid(),
    req :: undefined | reference(),
    err :: undefined | term(),
    result :: undefined | {error, term()} | {ok, term()},
    awaiters = [] :: [gen_statem:from()]
    }).

init([Type, Msg, Expect, ProtoFSM]) ->
    S0 = #?MODULE{type = Type, msg = Msg, expect = Expect, proto = ProtoFSM},
    case (catch krb_proto:encode(Type, Msg)) of
        {ok, _Bytes} -> {ok, wait, S0};
        Err -> {stop, Err}
    end.

wait(enter, _PrevState, _S0 = #?MODULE{}) ->
    keep_state_and_data;
wait({call, From}, await, S0 = #?MODULE{awaiters = Aws0, type = Type,
                                        msg = Msg}) ->
    S1 = S0#?MODULE{awaiters = [From | Aws0]},
    {ok, Bytes} = krb_proto:encode(Type, Msg),
    if
        (byte_size(Bytes) < 1500) ->
            {next_state, udp_single, S1};
        true ->
            {next_state, tcp, S1}
    end.

terminate(normal, _State, #?MODULE{}) ->
    ok;
terminate(Why, State, #?MODULE{}) ->
    lager:debug("terminating from ~p due to ~p", [State, Why]),
    ok.

callback_mode() -> [state_functions, state_enter].

send_req(Proto, N, S0 = #?MODULE{type = Type, msg = Msg, expect = Expect,
                                 proto = FSM}) ->
    {ok, Ref} = krb_proto_srv:start_req(FSM, Proto, N, Type, Msg, Expect),
    S0#?MODULE{req = Ref}.

udp_single(enter, _PrevState, S0 = #?MODULE{}) ->
    S1 = send_req(udp, 1, S0),
    {keep_state, S1, [{state_timeout, 100, multi}]};
udp_single(state_timeout, multi, S0 = #?MODULE{req = Req, proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    lager:debug("giving up on single KDC UDP attempt"),
    {next_state, udp_multi, S0};
udp_single(info, {krb_error, Req}, S0 = #?MODULE{req = Req}) ->
    {next_state, tcp, S0};
udp_single(info, {krb_reply, Req, #'KRB-ERROR'{'error-code' = 'KRB_ERR_RESPONSE_TOO_BIG'}},
                                                S0 = #?MODULE{req = Req,
                                                              proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, tcp, S0};
udp_single(info, {krb_reply, Req, E = #'KRB-ERROR'{}}, S0 = #?MODULE{req = Req}) ->
    S1 = S0#?MODULE{err = E},
    {keep_state, S1};
udp_single(info, {krb_reply, Req, Reply}, S0 = #?MODULE{req = Req, proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, done, S0#?MODULE{result = {ok, Reply}}};
udp_single(info, {krb_reply_done, Req}, S0 = #?MODULE{req = Req, err = E}) ->
    {next_state, done, S0#?MODULE{result = {error, E}}};
udp_single({call, From}, await, S0 = #?MODULE{awaiters = Aws0}) ->
    S1 = S0#?MODULE{awaiters = [From | Aws0]},
    {keep_state, S1}.

udp_multi(enter, _PrevState, S0 = #?MODULE{}) ->
    S1 = send_req(udp, 3, S0),
    {keep_state, S1};
udp_multi(info, {krb_error, Req}, S0 = #?MODULE{req = Req, proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, tcp, S0};
udp_multi(info, {krb_reply, Req, #'KRB-ERROR'{'error-code' = 'KRB_ERR_RESPONSE_TOO_BIG'}},
                                                S0 = #?MODULE{proto = FSM,
                                                              req = Req}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, tcp, S0};
udp_multi(info, {krb_reply, Req, E = #'KRB-ERROR'{}}, S0 = #?MODULE{req = Req}) ->
    S1 = S0#?MODULE{err = E},
    {keep_state, S1};
udp_multi(info, {krb_reply, Req, Reply}, S0 = #?MODULE{req = Req, proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, done, S0#?MODULE{result = {ok, Reply}}};
udp_multi(info, {krb_reply_done, Req}, S0 = #?MODULE{req = Req, err = E}) ->
    {next_state, done, S0#?MODULE{result = {error, E}}};
udp_multi({call, From}, await, S0 = #?MODULE{awaiters = Aws0}) ->
    S1 = S0#?MODULE{awaiters = [From | Aws0]},
    {keep_state, S1}.

tcp(enter, _PrevState, S0 = #?MODULE{}) ->
    S1 = send_req(tcp, 1, S0),
    {keep_state, S1};
tcp(info, {krb_error, Req}, S0 = #?MODULE{req = Req}) ->
    {next_state, done, S0#?MODULE{result = {error, no_kdcs_available}}};
tcp(info, {krb_reply, Req, E = #'KRB-ERROR'{}}, S0 = #?MODULE{req = Req}) ->
    S1 = S0#?MODULE{err = E},
    {keep_state, S1};
tcp(info, {krb_reply, Req, Reply}, S0 = #?MODULE{req = Req, proto = FSM}) ->
    krb_proto_srv:cancel_req(FSM, Req),
    {next_state, done, S0#?MODULE{result = {ok, Reply}}};
tcp(info, {krb_reply_done, Req}, S0 = #?MODULE{req = Req, err = E}) ->
    {next_state, done, S0#?MODULE{result = {error, E}}};
tcp({call, From}, await, S0 = #?MODULE{awaiters = Aws0}) ->
    S1 = S0#?MODULE{awaiters = [From | Aws0]},
    {keep_state, S1}.

done({call, From}, await, _S0 = #?MODULE{result = Res}) ->
    gen_statem:reply(From, Res),
    keep_state_and_data;
done(enter, _PrevState, S0 = #?MODULE{awaiters = Froms, result = Res}) ->
    [gen_statem:reply(From, Res) || From <- Froms],
    {keep_state, S0#?MODULE{awaiters = []}, [{state_timeout, 0, die}]};
done(state_timeout, die, S0 = #?MODULE{}) ->
    {stop, normal, S0}.
