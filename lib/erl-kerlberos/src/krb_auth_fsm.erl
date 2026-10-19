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
-module(krb_auth_fsm).
-behaviour(gen_statem).

-include("KRB5.hrl").

-compile([{parse_transform, lager_transform}]).

-export([
    start_link/2,
    await/1,
    start_link_and_await/2
    ]).

-export([
    init/1,
    callback_mode/0,
    terminate/3,
    done/3,
    wait/3,
    probe/3,
    auth/3
    ]).

-type result() :: {ok, krb_proto:ticket()} | {error, term()}.

-spec start_link_and_await(config(), ProtoFSM :: pid()) -> result().
start_link_and_await(Config, ProtoFSM) ->
    {ok, Pid} = start_link(Config, ProtoFSM),
    await(Pid).

-spec start_link(config(), ProtoFSM :: pid()) -> {ok, pid()}.
start_link(Config, ProtoFSM) ->
    gen_statem:start_link(?MODULE, [Config, ProtoFSM], []).

-spec await(pid()) -> result().
await(Pid) ->
    gen_statem:call(Pid, await).

-type secs() :: integer().

-type config() :: #{
    realm => string(),
    principal => [string()],
    flags => [krb_proto:kdc_flag()],
    etypes => [krb_crypto:etype()],
    lifetime => secs(),
    secret => binary()
    }.

-record(?MODULE, {
    proto :: pid(),
    config :: config(),
    key :: undefined | krb_crypto:base_key(),
    salt :: undefined | binary(),
    nonce :: undefined | integer(),
    etype :: undefined | krb_crypto:etype(),
    result :: undefined | result(),
    awaiters = [] :: [gen_statem:from()]
    }).

init([Config, ProtoFSM]) ->
    S0 = #?MODULE{config = Config, proto = ProtoFSM},
    {ok, wait, S0}.

wait(enter, _PrevState, _S0 = #?MODULE{}) ->
    keep_state_and_data;
wait({call, From}, await, S0 = #?MODULE{awaiters = Aws0}) ->
    S1 = S0#?MODULE{awaiters = [From | Aws0]},
    {next_state, probe, S1}.

done({call, From}, await, _S0 = #?MODULE{result = Res}) ->
    gen_statem:reply(From, Res),
    keep_state_and_data;
done(enter, _PrevState, S0 = #?MODULE{awaiters = Froms, result = Res}) ->
    [gen_statem:reply(From, Res) || From <- Froms],
    {keep_state, S0#?MODULE{awaiters = []}, [{state_timeout, 0, die}]};
done(state_timeout, die, S0 = #?MODULE{}) ->
    {stop, normal, S0}.

terminate(normal, _State, #?MODULE{}) ->
    ok;
terminate(Why, State, #?MODULE{}) ->
    lager:debug("terminating from ~p due to ~p", [State, Why]),
    ok.

callback_mode() -> [state_functions, state_enter].

probe(enter, _PrevState, S0 = #?MODULE{}) ->
    {keep_state, S0, [{state_timeout, 0, req}]};
probe(state_timeout, req, S0 = #?MODULE{proto = P, config = C}) ->
    #{realm := Realm, principal := Principal} = C,
    Options = sets:from_list(
        maps:get(flags, C, [renewable,proxiable,forwardable])),
    Lifetime = maps:get(lifetime, C, 4*3600),
    ETypes = maps:get(etypes, C, krb_crypto:default_etypes()),
    Nonce = rand:uniform(1 bsl 30),
    ReqBody = #'KDC-REQ-BODY'{
        'kdc-options' = krb_proto:encode_kdc_flags(Options),
        cname = #'PrincipalName'{
            'name-type' = 1,
            'name-string' = Principal},
        sname = #'PrincipalName'{
            'name-type' = 2,
            'name-string' = ["krbtgt", Realm]},
        realm = Realm,
        till = krb_proto:system_time_to_krbtime(
            erlang:system_time(second) + Lifetime, second),
        nonce = Nonce,
        etype = ETypes
    },
    Req = #'KDC-REQ'{
        pvno = 5,
        'msg-type' = 10,
        padata = [],
        'req-body' = ReqBody
    },
    {ok, Pid} = krb_req_fsm:start_link(
        'AS-REQ', Req, ['AS-REP', 'KRB-ERROR'], P),
    case krb_req_fsm:await(Pid) of
        {ok, Msg} ->
            probe(krb, Msg, S0);
        {error, Msg = #'KRB-ERROR'{}} ->
            probe(krb, Msg, S0);
        {error, Why} ->
            S1 = S0#?MODULE{result = {error, Why}},
            {next_state, done, S1}
    end;
probe(krb, E = #'KRB-ERROR'{'error-code' = 'KDC_ERR_PREAUTH_REQUIRED'},
                                                            S0 = #?MODULE{}) ->
    #'KRB-ERROR'{'e-data' = EDs} = E,
    EType2s = [D || #'PA-DATA'{'padata-type' = 19, 'padata-value' = D} <- EDs],
    EType1s = [D || #'PA-DATA'{'padata-type' = 11, 'padata-value' = D} <- EDs],
    {EType, Salt} = case {EType2s, EType1s} of
        {[[#'ETYPE-INFO2-ENTRY'{etype = ET, salt = asn1_NOVALUE} | _]], _} ->
            {krb_crypto:etype_to_atom(ET), <<>>};
        {[[#'ETYPE-INFO2-ENTRY'{etype = ET, salt = S} | _]], _} ->
            {krb_crypto:etype_to_atom(ET), iolist_to_binary([S])};
        {[], [[#'ETYPE-INFO-ENTRY'{etype = ET, salt = asn1_NOVALUE} | _]]} ->
            {krb_crypto:etype_to_atom(ET), <<>>};
        {[], [[#'ETYPE-INFO-ENTRY'{etype = ET, salt = S} | _]]} ->
            {krb_crypto:etype_to_atom(ET), iolist_to_binary([S])};
        _ ->
            #?MODULE{config = C} = S0,
            #{realm := Realm, principal := Principal} = C,
            {lists:last(maps:get(etypes, C, krb_crypto:default_etypes())),
             iolist_to_binary([Realm, Principal])}
    end,
    S1 = S0#?MODULE{etype = EType, salt = Salt},
    {next_state, auth, S1};

probe(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_ETYPE_NOSUPP'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, no_matching_etypes}},
    {next_state, done, S1};
probe(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_C_PRINCIPAL_UNKNOWN'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
probe(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_PRINCIPAL_NOT_UNIQUE'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
probe(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_POLICY'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
probe(krb, #'KRB-ERROR'{'error-code' = 'KRB_ERR_GENERIC', 'e-text' = Txt},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, generic, Txt}}},
    {next_state, done, S1};
probe(krb, #'KRB-ERROR'{'error-code' = Other},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, Other}}},
    {next_state, done, S1}.

auth(enter, _PrevState, S0 = #?MODULE{}) ->
    {keep_state, S0, [{state_timeout, 0, req}]};
auth(state_timeout, req, S0 = #?MODULE{proto = P, config = C, salt = S,
                                       etype = ET}) ->
    #{realm := Realm, principal := Principal, secret := Secret} = C,

    Options = sets:from_list(
        maps:get(flags, C, [renewable,proxiable,forwardable])),
    Lifetime = maps:get(lifetime, C, 4*3600),
    Nonce = rand:uniform(1 bsl 31),

    NowUSec = erlang:system_time(microsecond),
    NowMSec = NowUSec div 1000,
    USec = NowUSec rem 1000,
    NowKrb = krb_proto:system_time_to_krbtime(NowMSec, millisecond),

    ETypes = maps:get(etypes, C, krb_crypto:default_etypes()),

    ReqBody = #'KDC-REQ-BODY'{
        'kdc-options' = krb_proto:encode_kdc_flags(Options),
        cname = #'PrincipalName'{
            'name-type' = 1,
            'name-string' = Principal},
        sname = #'PrincipalName'{
            'name-type' = 2,
            'name-string' = ["krbtgt", Realm]},
        realm = Realm,
        till = krb_proto:system_time_to_krbtime(
            erlang:system_time(second) + Lifetime, second),
        nonce = Nonce,
        etype = ETypes
    },
    PAEncTs0 = #'PA-DATA'{
        'padata-value' = #'PA-ENC-TS-ENC'{
            patimestamp = NowKrb,
            pausec = USec
        }
    },
    Key = krb_crypto:string_to_key(ET, Secret, S),
    PAEncTs1 = krb_proto:encrypt(Key, as_req_pa_enc_ts, PAEncTs0),

    Req = #'KDC-REQ'{
        pvno = 5,
        'msg-type' = 10,
        padata = [PAEncTs1],
        'req-body' = ReqBody
    },
    S1 = S0#?MODULE{key = Key, nonce = Nonce},
    {ok, Pid} = krb_req_fsm:start_link(
        'AS-REQ', Req, ['AS-REP', 'KRB-ERROR'], P),
    case krb_req_fsm:await(Pid) of
        {ok, Msg} ->
            auth(krb, Msg, S1);
        {error, Msg = #'KRB-ERROR'{}} ->
            auth(krb, Msg, S1);
        {error, Why} ->
            S2 = S1#?MODULE{result = {error, Why}},
            {next_state, done, S2}
    end;
auth(krb, R0 = #'KDC-REP'{}, S0 = #?MODULE{nonce = Nonce, key = Key}) ->
    NowKrb = krb_proto:system_time_to_krbtime(
        erlang:system_time(second), second),

    {ok, R1} = krb_proto:decrypt(Key, as_rep_encpart, R0),
    #'KDC-REP'{'enc-part' = EP} = R1,

    Err = case EP of
        #'EncKDCRepPart'{nonce = Nonce, endtime = End, flags = Flags} ->
            EndBin = iolist_to_binary([End]),
            if
                (EndBin > NowKrb) ->
                    case [sets:is_element(X, Flags) || X <- [pre_auth,initial]] of
                        [true, true] -> none;
                        _ -> {bad_flags, sets:to_list(Flags)}
                    end;
                true -> {bad_endtime, End}
            end;
        #'EncKDCRepPart'{nonce = BadNonce} ->
            {bad_nonce, BadNonce};
        _ ->
            bad_encpart_rec
    end,
    case Err of
        none ->
            #?MODULE{config = #{principal := Principal}} = S0,
            T = krb_proto:ticket_from_rep(Principal, R1),
            S1 = S0#?MODULE{result = {ok, T}},
            {next_state, done, S1};
        _ ->
            S1 = S0#?MODULE{result = {error, {invalid_enc_part, Err}}},
            {next_state, done, S1}
    end;

auth(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_PREAUTH_FAILED'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_secret}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KRB_AP_ERR_BAD_INTEGRITY'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_secret}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_ETYPE_NOSUPP'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, no_matching_etypes}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_C_PRINCIPAL_UNKNOWN'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_PRINCIPAL_NOT_UNIQUE'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_POLICY'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = 'KRB_ERR_GENERIC', 'e-text' = Txt},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, generic, Txt}}},
    {next_state, done, S1};
auth(krb, #'KRB-ERROR'{'error-code' = Other},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, Other}}},
    {next_state, done, S1}.
