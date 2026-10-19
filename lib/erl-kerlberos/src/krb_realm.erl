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

%% @doc Represents a Kerberos realm for the purpose of interacting with it as
%%      a client.
-module(krb_realm).

-behaviour(gen_server).

-export([
    open/1,
    authenticate/4,
    authenticate/3,
    obtain_ticket/4,
    obtain_ticket/3
    ]).

-export([
    start_link/1,
    init/1,
    terminate/2,
    handle_call/3,
    handle_info/2,
    handle_cast/2
    ]).

-type realm() :: string().
-type principal() :: [string()].
-type password() :: binary().
-type secs() :: integer().

%% @private
-spec start_link(realm()) -> {ok, pid()} | {error, term()}.
start_link(Realm) ->
    gen_server:start_link(?MODULE, [Realm], []).

%% @doc Opens a client for a Kerberos realm, either returning an existing
%%      client process or starting a new one.
-spec open(realm()) -> {ok, pid()} | {error, term()}.
open(Realm) ->
    case krb_realm_db:lookup(Realm) of
        {ok, Pid} ->
            {ok, Pid};
        {error, not_found} ->
            case krb_realm_sup:start_child(Realm) of
                {ok, Pid} ->
                    {ok, Pid};
                {error, already_registered} ->
                    open(Realm);
                Err ->
                    Err
            end
    end.


-type auth_options() :: #{lifetime => secs(),
                          flags => [krb_proto:kdc_flag()]}.

%% @doc Performs an initial Kerberos password authentication for the given
%%      principal (AS-REQ with an encrypted timestamp).
-spec authenticate(pid(), principal(), password(), auth_options()) ->
    {ok, krb_proto:ticket()} | {error, term()}.
authenticate(Pid, Principal, Secret, Options) ->
    gen_server:call(Pid, {authenticate, Principal, Secret, Options}, infinity).

%% @doc Performs an initial Kerberos password authentication for the given
%%      principal (AS-REQ with an encrypted timestamp).
-spec authenticate(pid(), principal(), password()) ->
    {ok, krb_proto:ticket()} | {error, term()}.
authenticate(Pid, Principal, Secret) ->
    authenticate(Pid, Principal, Secret, #{}).

-type tgs_options() :: #{lifetime => secs(),
                         flags => [krb_proto:kdc_flag()],
                         request_pac => boolean()}.

%% @doc Obtains a service ticket using the given Ticket-Granting Ticket (TGT)
%%      for the specified service principal (TGS-REQ).
-spec obtain_ticket(pid(), krb_proto:ticket(), principal(), tgs_options()) ->
    {ok, krb_proto:ticket()} | {error, term()}.
obtain_ticket(Pid, TGT, ServicePrincipal, Options) ->
    gen_server:call(Pid, {obtain_ticket, TGT, ServicePrincipal, Options}, infinity).

%% @doc Obtains a service ticket using the given Ticket-Granting Ticket (TGT)
%%      for the specified service principal (TGS-REQ).
-spec obtain_ticket(pid(), krb_proto:ticket(), principal()) ->
    {ok, krb_proto:ticket()} | {error, term()}.
obtain_ticket(Pid, TGT, ServicePrincipal) ->
    gen_server:call(Pid, {obtain_ticket, TGT, ServicePrincipal, #{}}, infinity).

-record(?MODULE, {
    realm :: realm(),
    config :: krb_realm_conf:config(),
    protosrv :: pid(),
    tref :: reference()
    }).

%% @private
init([Realm]) ->
    Config = krb_realm_conf:configure(Realm),
    #{kdc := Kdcs, ttl := TTL} = Config,
    {ok, TRef} = timer:send_after(TTL, refresh_config),
    case Kdcs of
        [] ->
            {stop, no_configured_kdcs};
        _ ->
            case krb_proto_srv:start_link(Config) of
                {ok, ProtoSrv} ->
                    case krb_realm_db:register(Realm) of
                        ok ->
                            S0 = #?MODULE{realm = Realm,
                                          config = Config,
                                          protosrv = ProtoSrv,
                                          tref = TRef},
                            {ok, S0};
                        {error, already_registered} ->
                            {stop, already_registered};
                        {error, Why} ->
                            {stop, {register_failed, Why}}
                    end;
                {error, Why} ->
                    {stop, {proto_srv_failed, Why}}
            end
    end.

%% @private
terminate(_Why, #?MODULE{protosrv = Srv}) ->
    krb_proto_srv:drain(Srv),
    ok.

%% @private
handle_info(refresh_config, S0 = #?MODULE{realm = R, protosrv = PS0,
                                          config = C0}) ->
    CI0 = maps:remove(ttl, C0),
    C1 = krb_realm_conf:configure(R),
    CI1 = maps:remove(ttl, C1),
    case CI0 of
        CI1 ->
            #{ttl := TTL} = C1,
            {ok, TRef} = timer:send_after(TTL, refresh_config),
            S1 = S0#?MODULE{tref = TRef},
            {noreply, S1};
        _ ->
            ok = krb_proto_srv:drain(PS0),
            {ok, PS1} = krb_proto_srv:start_link(C1),
            S1 = S0#?MODULE{config = C1, protosrv = PS1},
            {noreply, S1}
    end.

%% @private
handle_call({authenticate, Princ, Secret, Opts}, _From,
                    S0 = #?MODULE{config = C0, protosrv = PS0, realm = R}) ->
    C1 = maps:merge(C0, Opts),
    C2 = C1#{realm => R, principal => Princ, secret => Secret},
    Ret = krb_auth_fsm:start_link_and_await(C2, PS0),
    case Ret of
        {error, no_matching_etypes} ->
            % Some KDCs don't handle being asked about the new SHA2 etypes
            % very well. Strip them out if we get a no_matching_etypes and
            % try again, just in case.
            ETypes = maps:get(etypes, C2, krb_crypto:default_etypes()),
            Members = {lists:member(aes128_hmac_sha256, ETypes),
                       lists:member(aes256_hmac_sha384, ETypes)},
            case Members of
                {A, B} when A or B ->
                    NewEtypes = ETypes -- [aes128_hmac_sha256,
                        aes256_hmac_sha384],
                    C3 = C2#{etypes => NewEtypes},
                    Ret2 = krb_auth_fsm:start_link_and_await(C3, PS0),
                    {reply, Ret2, S0};
                _ ->
                    {reply, Ret, S0}
            end;
        _ ->
            {reply, Ret, S0}
    end;

handle_call({obtain_ticket, TGT, Princ, Opts}, _From,
                    S0 = #?MODULE{config = C0, protosrv = PS0, realm = R}) ->
    C1 = maps:merge(C0, Opts),
    C2 = C1#{realm => R, principal => Princ, tgt => TGT},
    Ret = krb_tkt_grant_fsm:start_link_and_await(C2, PS0),
    {reply, Ret, S0}.

%% @private
handle_cast(_, #?MODULE{}) ->
    error(no_casts).
