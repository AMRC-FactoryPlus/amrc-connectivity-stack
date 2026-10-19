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
-module(krb_tkt_grant_fsm).
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
    tgsreq/3
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
    tgt => krb_proto:ticket(),
    principal => [string()],
    flags => [krb_proto:kdc_flag()],
    etypes => [krb_crypto:etype()],
    lifetime => secs(),
    request_pac => boolean()
    }.

-record(?MODULE, {
    proto :: pid(),
    config :: config(),
    nonce :: undefined | integer(),
    key :: undefined | krb_crypto:base_key(),
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
    {next_state, tgsreq, S1}.

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

tgsreq(enter, _PrevState, S0 = #?MODULE{}) ->
    {keep_state, S0, [{state_timeout, 0, req}]};
tgsreq(state_timeout, req, S0 = #?MODULE{proto = P, config = C}) ->
    #{realm := Realm, principal := Principal, tgt := TgtInfo} = C,
    #{realm := TgtRealm, key := TgtKey, ticket := TgtTicket,
      principal := TgtPrincipal} = TgtInfo,
    Options = sets:from_list(
        maps:get(flags, C, [renewable,proxiable,forwardable])),
    Lifetime = maps:get(lifetime, C, 4*3600),
    ETypes = maps:get(etypes, C, krb_crypto:default_etypes()),
    Nonce = rand:uniform(1 bsl 31),
    RequestPAC = maps:get(request_pac, C, true),

    NowUSec = erlang:system_time(microsecond),
    NowMSec = NowUSec div 1000,
    USec = NowUSec rem 1000,
    NowKrb = krb_proto:system_time_to_krbtime(NowMSec, millisecond),

    SvcKey = krb_crypto:random_to_key(krb_crypto:key_etype(TgtKey)),

    ReqBody = #'KDC-REQ-BODY'{
        'kdc-options' = krb_proto:encode_kdc_flags(Options),
        sname = #'PrincipalName'{
            'name-type' = 2,
            'name-string' = Principal},
        realm = Realm,
        till = krb_proto:system_time_to_krbtime(
            erlang:system_time(second) + Lifetime, second),
        nonce = Nonce,
        etype = ETypes
    },
    CKey = krb_crypto:base_key_to_ck_key(TgtKey),
    Cksum = krb_proto:checksum(CKey, tgs_req_auth_cksum, ReqBody),
    Auth = #'Authenticator'{
        'authenticator-vno' = 5,
        crealm = TgtRealm,
        cname = #'PrincipalName'{
            'name-type' = 1,
            'name-string' = TgtPrincipal},
        ctime = NowKrb,
        cusec = USec,
        cksum = Cksum,
        subkey = SvcKey
    },
    APReq0 = #'AP-REQ'{
        pvno = 5,
        'msg-type' = 14,
        ticket = TgtTicket,
        authenticator = Auth,
        'ap-options' = <<0:32>>
    },
    APReq1 = krb_proto:encrypt(TgtKey, tgs_req_auth, APReq0),
    PAData0 = [
        #'PA-DATA'{'padata-value' = APReq1}
    ],
    PAData1 = case RequestPAC of
        true ->
            PAData0 ++ [
                #'PA-DATA'{'padata-value' =
                    #'PA-PAC-REQUEST'{'include-pac' = true}}
            ];
        false -> PAData0
    end,
    Req = #'KDC-REQ'{
        pvno = 5,
        'msg-type' = 12,
        padata = PAData1,
        'req-body' = ReqBody
    },
    S1 = S0#?MODULE{key = SvcKey, nonce = Nonce},
    {ok, Pid} = krb_req_fsm:start_link(
        'TGS-REQ', Req, ['TGS-REP', 'KRB-ERROR'], P),
    case krb_req_fsm:await(Pid) of
        {ok, Msg} ->
            tgsreq(krb, Msg, S1);
        {error, Msg = #'KRB-ERROR'{}} ->
            tgsreq(krb, Msg, S1);
        {error, Why} ->
            S2 = S1#?MODULE{result = {error, Why}},
            {next_state, done, S2}
    end;

tgsreq(krb, R0 = #'KDC-REP'{}, S0 = #?MODULE{nonce = Nonce, key = Key}) ->
    NowKrb = krb_proto:system_time_to_krbtime(
        erlang:system_time(second), second),

    {ok, R1} = krb_proto:decrypt(Key, tgs_rep_encpart_subkey, R0),
    #'KDC-REP'{'enc-part' = EP} = R1,

    Err = case EP of
        #'EncKDCRepPart'{nonce = Nonce, endtime = End} ->
            EndBin = iolist_to_binary([End]),
            if
                (EndBin > NowKrb) -> none;
                true -> {bad_endtime, End}
            end;
        #'EncKDCRepPart'{nonce = BadNonce} ->
            {bad_nonce, BadNonce};
        _ ->
            bad_encpart_rec
    end,
    case Err of
        none ->
            #?MODULE{config = #{tgt := #{principal := TgtPrincipal}}} = S0,
            T = krb_proto:ticket_from_rep(TgtPrincipal, R1),
            S1 = S0#?MODULE{result = {ok, T}},
            {next_state, done, S1};
        _ ->
            S1 = S0#?MODULE{result = {error, {invalid_enc_part, Err}}},
            {next_state, done, S1}
    end;

tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_PREAUTH_FAILED'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_secret}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KRB_AP_ERR_BAD_INTEGRITY'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_secret}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_ETYPE_NOSUPP'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, no_matching_etypes}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_C_PRINCIPAL_UNKNOWN'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_PRINCIPAL_NOT_UNIQUE'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KDC_ERR_POLICY'},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, bad_principal}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = 'KRB_ERR_GENERIC', 'e-text' = Txt},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, generic, Txt}}},
    {next_state, done, S1};
tgsreq(krb, #'KRB-ERROR'{'error-code' = Other},
                                                            S0 = #?MODULE{}) ->
    S1 = S0#?MODULE{result = {error, {krb5, Other}}},
    {next_state, done, S1}.
