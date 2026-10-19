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

%% @doc GSS mechanism module for the SPNEGO meta-mechanism (based on RFC4178).
-module(gss_spnego).
-behaviour(gss_mechanism).

-compile([{parse_transform, lager_transform}]).

-include("KRB5.hrl").
-include("SPNEGO.hrl").

% see rfc4178

-export([
    initiate/1,
    accept/2,
    continue/2,
    delete/1
    ]).

-export([
    wrap/2,
    unwrap/2,
    get_mic/2,
    verify_mic/3
    ]).

-export([
    local_name/1,
    peer_name/1,
    translate_name/2
    ]).

-export([mech_specific/4]).

-type oid() :: tuple().

-type options() :: #{mech_prefs => [oid()], init_token => boolean()} | gss_mechanism:general_options().

-type state() :: gss_mechanism:state().
-type token() :: gss_mechanism:token().
-type message() :: gss_mechanism:message().

-record(?MODULE, {
    party :: acceptor | initiator,
    state :: running | initial | await_opt | await_opt_acc | await_mech |
        await_token | accepted | continue | err_next,
    want_mic = false :: boolean(),
    config :: options(),
    mech :: none | oid(),
    mechmod :: module(),
    mechstate :: term()
    }).

-define(mechs, #{
    ?'id-mech-krb5' => gss_krb5
    }).
-define(default_mech_prefs, [?'id-mech-krb5']).

spnego_initiator_fsm(initial, _, S0 = #?MODULE{config = Opts}) ->
    MechPrefs = maps:get(mech_prefs, Opts, ?default_mech_prefs),
    InitToken = maps:get(init_token, Opts, true),
    case InitToken of
        true ->
            [Mech | _] = MechPrefs,
            #{Mech := Mod} = ?mechs,
            S1 = S0#?MODULE{mech = Mech, mechmod = Mod},
            case Mod:initiate(Opts) of
                {ok, MToken0, MS0} ->
                    TokenRec = #'NegTokenInit'{
                        mechTypes = MechPrefs,
                        mechToken = MToken0
                    },
                    {ok, MechData} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenInit', TokenRec}),
                    Token = gss_token:encode_initial(?'id-mech-spnego',
                        MechData),
                    S2 = S1#?MODULE{state = await_opt_acc, mechstate = MS0},
                    {continue, Token, S2};
                {continue, MToken0, MS0} ->
                    TokenRec =  #'NegTokenInit'{
                        mechTypes = MechPrefs,
                        mechToken = MToken0
                    },
                    {ok, MechData} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenInit', TokenRec}),
                    Token = gss_token:encode_initial(?'id-mech-spnego',
                        MechData),
                    S2 = S1#?MODULE{state = await_opt, mechstate = MS0},
                    {continue, Token, S2};
                Err = {error, _Why} -> Err
            end;
        false ->
            TokenRec = #'NegTokenInit'{
                mechTypes = MechPrefs
            },
            {ok, MechData} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenInit', TokenRec}),
            Token = gss_token:encode_initial(?'id-mech-spnego',
                MechData),
            S1 = S0#?MODULE{state = await_mech},
            {continue, Token, S1}
    end;
spnego_initiator_fsm(await_opt_acc, T = #'NegTokenResp'{negState = 'reject'},
                                                            S0 = #?MODULE{}) ->
    spnego_initiator_fsm(continue, T, S0);
spnego_initiator_fsm(await_opt, T = #'NegTokenResp'{negState = 'reject'},
                                                            S0 = #?MODULE{}) ->
    spnego_initiator_fsm(continue, T, S0);
spnego_initiator_fsm(await_opt_acc, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{supportedMech = Mech} = T,
    #?MODULE{mech = Mech0} = S0,
    case Mech of
        Mech0 ->
            spnego_initiator_fsm(accepted, T, S0);
        _ ->
            spnego_initiator_fsm(await_mech, T, S0)
    end;
spnego_initiator_fsm(await_opt, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{supportedMech = Mech} = T,
    #?MODULE{mech = Mech0} = S0,
    case Mech of
        Mech0 ->
            spnego_initiator_fsm(continue, T, S0);
        _ ->
            spnego_initiator_fsm(await_mech, T, S0)
    end;
spnego_initiator_fsm(await_mech, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{negState = NS, supportedMech = Mech} = T,
    #?MODULE{config = Opts} = S0,
    case ?mechs of
        #{Mech := Mod} ->
            S1 = S0#?MODULE{mech = Mech, mechmod = Mod},
            case Mod:initiate(Opts) of
                {ok, MToken0, MS0} when (NS =:= 'request-mic') ->
                    S2 = S1#?MODULE{mechstate = MS0},
                    {MIC, S3} = make_mechlist_mic(S2),
                    TokenRec = #'NegTokenResp'{
                        negState = 'request-mic',
                        responseToken = MToken0,
                        mechListMIC = MIC
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S4 = S3#?MODULE{state = accepted, want_mic = true},
                    {continue, Token, S4};
                {ok, MToken0, MS0} ->
                    TokenRec = #'NegTokenResp'{
                        negState = 'accept-completed',
                        responseToken = MToken0
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S2 = S1#?MODULE{state = accepted, mechstate = MS0,
                                    want_mic = false},
                    {ok, Token, S2};
                {continue, MToken0, MS0} ->
                    TokenRec = #'NegTokenResp'{
                        negState = 'accept-incomplete',
                        responseToken = MToken0
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S2 = S1#?MODULE{state = continue, mechstate = MS0,
                                    want_mic = (NS =:= 'request-mic')},
                    {continue, Token, S2};
                Err = {error, _Why} -> Err
            end;
        _ ->
            lager:debug("remote side tried unknown spnego mech ~p, rejecting",
                [Mech]),
            TokenRec = #'NegTokenResp'{
                negState = 'reject'
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S1 = S0#?MODULE{state = err_next, mech = Mech},
            {continue, Token, S1}
    end;
spnego_initiator_fsm(accepted,
        #'NegTokenResp'{negState = 'accept-completed'},
        S0 = #?MODULE{want_mic = false}) ->
    S1 = S0#?MODULE{state = running},
    {ok, S1};
spnego_initiator_fsm(accepted,
        #'NegTokenResp'{negState = 'accept-completed', mechListMIC = MIC},
        S0 = #?MODULE{want_mic = true}) ->
    case verify_mechlist_mic(MIC, S0) of
        {true, S1} ->
            S2 = S1#?MODULE{state = running},
            {ok, S2};
        {false, _S1} ->
            {error, defective_token}
    end;
spnego_initiator_fsm(continue, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{negState = NS, responseToken = MToken0,
                    mechListMIC = MIC} = T,
    #?MODULE{mechmod = Mod, mechstate = MS0, want_mic = WantMIC0} = S0,
    WantMIC1 = case NS of
        'request-mic' -> true;
        _ -> WantMIC0
    end,
    WantMIC2 = case MIC of
        asn1_NOVALUE -> WantMIC1;
        _ -> true
    end,
    case WantMIC2 of
        true ->
            case Mod:continue(MToken0, MS0) of
                {ok, MS1} ->
                    S1 = S0#?MODULE{mechstate = MS1},
                    case verify_mechlist_mic(MIC, S1) of
                        {true, S2} ->
                            {OurMIC, S3} = make_mechlist_mic(S2),
                            TokenRec = #'NegTokenResp'{
                                negState = 'accept-completed',
                                mechListMIC = OurMIC
                            },
                            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                                {'negTokenResp', TokenRec}),
                            S4 = S3#?MODULE{state = running,
                                            want_mic = true},
                            {ok, Token, S4};
                        {false, _S2} ->
                            {error, defective_token}
                    end;
                {ok, MToken1, MS1} ->
                    S1 = S0#?MODULE{mechstate = MS1},
                    case verify_mechlist_mic(MIC, S1) of
                        {true, S2} ->
                            {OurMIC, S3} = make_mechlist_mic(S2),
                            TokenRec = #'NegTokenResp'{
                                negState = 'accept-completed',
                                responseToken = MToken1,
                                mechListMIC = OurMIC
                            },
                            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                                {'negTokenResp', TokenRec}),
                            S4 = S3#?MODULE{state = accepted, want_mic = true},
                            {continue, Token, S4};
                        {false, _S2} ->
                            {error, defective_token}
                    end;
                {continue, MToken1, MS1} ->
                    S1 = S0#?MODULE{mechstate = MS1},
                    case verify_mechlist_mic(MIC, S1) of
                        {true, S2} ->
                            TokenRec = #'NegTokenResp'{
                                negState = 'accept-incomplete',
                                responseToken = MToken1
                            },
                            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                                {'negTokenResp', TokenRec}),
                            S3 = S2#?MODULE{state = continue, mechstate = MS1,
                                            want_mic = true},
                            {continue, Token, S3};
                        {false, _S2} ->
                            {error, defective_token}
                    end;
                Err = {error, _Why} -> Err
            end;
        false ->
            case Mod:continue(MToken0, MS0) of
                {ok, MS1} when (NS =:= 'accept-completed') ->
                    S1 = S0#?MODULE{state = running, mechstate = MS1},
                    {ok, S1};

                {ok, MS1} ->
                    TokenRec = #'NegTokenResp'{
                        negState = 'accept-completed'
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S1 = S0#?MODULE{state = running, mechstate = MS1},
                    {ok, Token, S1};

                {ok, MToken1, MS1} ->
                    TokenRec = #'NegTokenResp'{
                        negState = 'accept-completed',
                        responseToken = MToken1
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S1 = S0#?MODULE{state = running, mechstate = MS1},
                    {ok, Token, S1};

                {continue, MToken1, MS1} ->
                    TokenRec = #'NegTokenResp'{
                        negState = 'accept-incomplete',
                        responseToken = MToken1
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S1 = S0#?MODULE{state = continue, mechstate = MS1},
                    {continue, Token, S1};

                Err = {error, _Why} -> Err
            end
    end;
spnego_initiator_fsm(running, _, _S0 = #?MODULE{}) ->
    {error, bad_state}.

select_mech([]) -> {error, no_match};
select_mech([NextPref | Rest]) ->
    case ?mechs of
        #{NextPref := Mod} -> {ok, NextPref, Mod};
        _ -> select_mech(Rest)
    end.

spnego_acceptor_fsm(initial, T = #'NegTokenInit'{}, S0 = #?MODULE{}) ->
    #'NegTokenInit'{mechTypes = MechPrefs, mechToken = MToken0} = T,
    #?MODULE{config = Opts, want_mic = WantMIC} = S0,
    case select_mech(MechPrefs) of
        {ok, Mech, Mod} ->
            S1 = S0#?MODULE{state = await_token,
                            mech = Mech, mechmod = Mod},
            IsFirstPref = case MechPrefs of
                [Mech | _] -> true;
                _ -> false
            end,
            HasToken = case MToken0 of
                asn1_NOVALUE -> false;
                _ -> true
            end,
            case {IsFirstPref, HasToken} of
                {true, true} ->
                    Result = Mod:accept(MToken0, Opts),
                    T0 = #'NegTokenResp'{supportedMech = Mech},
                    spnego_accept_common(false, T0, asn1_NOVALUE, Result, S1);
                {_, _} ->
                    TokenRec = #'NegTokenResp'{
                        negState = case WantMIC of
                            true -> 'request-mic';
                            false -> 'accept-incomplete'
                        end,
                        supportedMech = Mech
                    },
                    {ok, MechData} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    Token = gss_token:encode_initial(?'id-mech-spnego',
                        MechData),
                    {continue, Token, S1}
            end;
        {error, no_match} ->
            TokenRec = #'NegTokenResp'{
                negState = 'reject'
            },
            {ok, MechData} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            Token = gss_token:encode_initial(?'id-mech-spnego', MechData),
            S1 = S0#?MODULE{state = err_next},
            {continue, Token, S1}
    end;
spnego_acceptor_fsm(await_token, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{negState = NS, responseToken = MToken0,
                    mechListMIC = MIC} = T,
    #?MODULE{config = Opts, mechmod = Mod, want_mic = WantMIC0} = S0,
    WantMIC1 = case NS of
        'request-mic' -> true;
        _ -> WantMIC0
    end,
    WantMIC2 = case MIC of
        asn1_NOVALUE -> WantMIC1;
        _ -> true
    end,
    S1 = S0#?MODULE{want_mic = WantMIC2},
    ExpectMIC = case NS of
        'request-mic' -> WantMIC2;
        'accept-completed' -> WantMIC2;
        _ -> false
    end,
    Result = Mod:accept(MToken0, Opts),
    T0 = #'NegTokenResp'{},
    spnego_accept_common(ExpectMIC, T0, MIC, Result, S1);
spnego_acceptor_fsm(continue, T = #'NegTokenResp'{}, S0 = #?MODULE{}) ->
    #'NegTokenResp'{negState = NS, responseToken = MToken0,
                    mechListMIC = MIC} = T,
    #?MODULE{mechmod = Mod, mechstate = MS0, want_mic = WantMIC0} = S0,
    WantMIC1 = case NS of
        'request-mic' -> true;
        _ -> WantMIC0
    end,
    WantMIC2 = case MIC of
        asn1_NOVALUE -> WantMIC1;
        _ -> true
    end,
    S1 = S0#?MODULE{want_mic = WantMIC2},
    ExpectMIC = case NS of
        'request-mic' -> WantMIC2;
        'accept-completed' -> WantMIC2;
        _ -> false
    end,
    Result = Mod:continue(MToken0, MS0),
    T0 = #'NegTokenResp'{},
    spnego_accept_common(ExpectMIC, T0, MIC, Result, S1);
spnego_acceptor_fsm(accepted,
                    #'NegTokenResp'{negState = 'accept-completed'},
                    S0 = #?MODULE{want_mic = false}) ->
    S1 = S0#?MODULE{state = running},
    {ok, S1};
spnego_acceptor_fsm(accepted,
                    #'NegTokenResp'{negState = 'accept-completed',
                                    mechListMIC = MIC},
                    S0 = #?MODULE{want_mic = true}) ->
    case verify_mechlist_mic(MIC, S0) of
        {true, S1} ->
            S2 = S1#?MODULE{state = running},
            {ok, S2};
        {false, _S1} ->
            {error, defective_token}
    end;
spnego_acceptor_fsm(_, _, _S0 = #?MODULE{}) ->
    {error, bad_state}.

spnego_accept_common(_ExpectMIC = true, T0, MIC, Result, S0 = #?MODULE{}) ->
    case Result of
        {ok, MS0} ->
            S1 = S0#?MODULE{mechstate = MS0},
            case verify_mechlist_mic(MIC, S1) of
                {true, S2} ->
                    {OurMIC, S3} = make_mechlist_mic(S2),
                    TokenRec = T0#'NegTokenResp'{
                        negState = 'accept-completed',
                        mechListMIC = OurMIC
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S4 = S3#?MODULE{state = running, want_mic = true},
                    {ok, Token, S4};
                {false, _S2} ->
                    {error, defective_token}
            end;
        {ok, MToken1, MS0} ->
            S1 = S0#?MODULE{mechstate = MS0},
            case verify_mechlist_mic(MIC, S1) of
                {true, S2} ->
                    {OurMIC, S3} = make_mechlist_mic(S2),
                    TokenRec = T0#'NegTokenResp'{
                        negState = 'accept-completed',
                        responseToken = MToken1,
                        mechListMIC = OurMIC
                    },
                    {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                        {'negTokenResp', TokenRec}),
                    S4 = S3#?MODULE{state = accepted, want_mic = true},
                    {continue, Token, S4};
                {false, _S2} ->
                    {error, defective_token}
            end;
        {continue, MToken1, MS0} ->
            TokenRec = T0#'NegTokenResp'{
                negState = 'request-mic',
                responseToken = MToken1
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S1 = S0#?MODULE{state = continue, mechstate = MS0,
                            want_mic = true},
            {continue, Token, S1};
        Err = {error, _Why} -> Err
    end;
spnego_accept_common(_ExpectMIC = false, T0, _MIC, Result, S0 = #?MODULE{}) ->
    #?MODULE{want_mic = WantMIC} = S0,
    case Result of
        {ok, MS0} when WantMIC ->
            S1 = S0#?MODULE{mechstate = MS0},
            {OurMIC, S2} = make_mechlist_mic(S1),
            TokenRec = T0#'NegTokenResp'{
                negState = 'request-mic',
                mechListMIC = OurMIC
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S3 = S2#?MODULE{state = accepted},
            {continue, Token, S3};
        {ok, MS0} ->
            TokenRec = T0#'NegTokenResp'{negState = 'accept-completed'},
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S1 = S0#?MODULE{state = running, mechstate = MS0},
            {ok, Token, S1};
        {ok, MToken1, MS0} when WantMIC ->
            S1 = S0#?MODULE{mechstate = MS0},
            {OurMIC, S2} = make_mechlist_mic(S1),
            TokenRec = T0#'NegTokenResp'{
                negState = 'request-mic',
                responseToken = MToken1,
                mechListMIC = OurMIC
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S3 = S2#?MODULE{state = accepted},
            {continue, Token, S3};
        {ok, MToken1, MS0} ->
            TokenRec = T0#'NegTokenResp'{
                negState = 'accept-completed',
                responseToken = MToken1
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S1 = S0#?MODULE{state = running, mechstate = MS0},
            {ok, Token, S1};
        {continue, MToken1, MS0} ->
            TokenRec = T0#'NegTokenResp'{
                negState = 'accept-incomplete',
                responseToken = MToken1
            },
            {ok, Token} = 'SPNEGO':encode('NegotiationToken',
                {'negTokenResp', TokenRec}),
            S1 = S0#?MODULE{state = continue, mechstate = MS0},
            {continue, Token, S1};
        Err = {error, _Why} -> Err
    end.

make_mechlist_mic(S0 = #?MODULE{config = Opts, mechmod = Mod,
                                mechstate = MS0}) ->
    MechPrefs = maps:get(mech_prefs, Opts, ?default_mech_prefs),
    {ok, MechListBin} = 'SPNEGO':encode('MechTypeList', MechPrefs),
    {ok, MIC, MS1} = Mod:get_mic(MechListBin, MS0),
    S1 = S0#?MODULE{mechstate = MS1},
    {MIC, S1}.

verify_mechlist_mic(asn1_NOVALUE, S0) ->
    {false, S0};
verify_mechlist_mic(MIC, S0 = #?MODULE{config = Opts, mechmod = Mod,
                                       mechstate = MS0}) ->
    MechPrefs = maps:get(mech_prefs, Opts, ?default_mech_prefs),
    {ok, MechListBin} = 'SPNEGO':encode('MechTypeList', MechPrefs),
    case Mod:verify_mic(MechListBin, MIC, MS0) of
        {ok, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {true, S1};
        {error, Why, MS1} ->
            lager:debug("mechlist MIC failed: ~p", [Why]),
            S1 = S0#?MODULE{mechstate = MS1},
            {false, S1};
        {error, Why} ->
            lager:debug("mechlist MIC failed: ~p", [Why]),
            {false, S0}
    end.

%% @doc Begins a new GSS context as the initiator (connecting) party.
%%
%% If returning <code>{ok, token(), state()}</code>, then the <code>token</code>
%% is the last token in the setup flow (and after transporting it to the
%% acceptor, applications should begin calling <code>get_mic/2</code> and
%% <code>wrap/2</code>).
%%
%% If returning <code>{continue, token(), state()}</code>, the mechanism expects
%% a reply to the given token first, which should be given to
%% <code>continue/2</code>.
-spec initiate(options()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    gss_mechanism:fatal_error().
initiate(Opts) ->
    S0 = #?MODULE{config = Opts, party = initiator, state = initial,
                  mech = none, mechmod = none},
    spnego_initiator_fsm(initial, none, S0).

%% @doc Begins a new GSS context as the acceptor (listening) party.
%%
%% If returning <code>{ok, token(), state()}</code>, then the <code>token</code>
%% is the last token in the setup flow (and after transporting it to the
%% initiator, applications should begin calling <code>get_mic/2</code> and
%% <code>wrap/2</code>).
%%
%% If returning <code>{continue, token(), state()}</code>, the mechanism expects
%% a reply to the given token first, which should be given to
%% <code>continue/2</code>.
-spec accept(token(), options()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    gss_mechanism:fatal_error().
accept(Token, Opts) ->
    S0 = #?MODULE{config = Opts, party = acceptor, state = initial,
                  mech = none, mechmod = none},
    continue(Token, S0).

%% @doc Continues an initiate() or accept() operation with a new token from the
%% other party.
%%
%% Return values have the same meaning as in <code>initiate/1</code> or
%% <code>accept/2</code>.
-spec continue(token(), state()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    gss_mechanism:fatal_error().
continue(Token, S0 = #?MODULE{party = initiator, state = State}) ->
    case (catch gss_token:decode_initial(Token)) of
        {'EXIT', _Why} -> MechData = Token;
        {?'id-mech-spnego', MechData, <<>>} -> ok
    end,
    case 'SPNEGO':decode('NegotiationToken', MechData) of
        {ok, {negTokenResp, T}, <<>>} ->
            spnego_initiator_fsm(State, T, S0);
        Err ->
            {error, {defective_token, Err}}
    end;
continue(Token, S0 = #?MODULE{party = acceptor, state = State}) ->
    case (catch gss_token:decode_initial(Token)) of
        {'EXIT', _Why} -> MechData = Token;
        {?'id-mech-spnego', MechData, <<>>} -> ok
    end,
    case 'SPNEGO':decode('NegotiationToken', MechData) of
        {ok, {negTokenInit, T}, <<>>} ->
            spnego_acceptor_fsm(State, T, S0);
        {ok, {negTokenResp, T}, <<>>} ->
            spnego_acceptor_fsm(State, T, S0);
        Err ->
            {error, {defective_token, Err}}
    end.

%% @doc Wraps a message into a token, which may encrypt and checksum it as
%% needed (depending on mechanism and the options given).
%%
%% A Wrap Token should be transported to the other party without any additional
%% information.
-spec wrap(message(), state()) ->
    {ok, token(), state()} |
    gss_mechanism:fatal_error().
wrap(Message, S0 = #?MODULE{state = running,
                            mechmod = Mod, mechstate = MS0}) ->
    case Mod:wrap(Message, MS0) of
        {ok, Token, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, Token, S1};
        Err ->
            Err
    end.

%% @doc Validates and unpacks a Wrap token which has been received, returning
%% the enclosed message.
-spec unwrap(token(), state()) ->
    {ok, message(), state()} |
    gss_mechanism:per_msg_error() |
    gss_mechanism:fatal_error().
unwrap(Token, S0 = #?MODULE{state = running,
                            mechmod = Mod, mechstate = MS0}) ->
    case Mod:unwrap(Token, MS0) of
        {ok, Message, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, Message, S1};
        {error, Err, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {error, Err, S1};
        Err = {error, _Why} ->
            Err
    end.

%% @doc Computes a MIC (Message Integrity Check) token for a given message.
%%
%% A MIC token should be transported to the other party alongside the message
%% so that they may check its integrity (the token does not contain the
%% message).
-spec get_mic(message(), state()) ->
    {ok, token(), state()} |
    gss_mechanism:fatal_error().
get_mic(Message, S0 = #?MODULE{state = running,
                               mechmod = Mod, mechstate = MS0}) ->
    case Mod:get_mic(Message, MS0) of
        {ok, Token, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, Token, S1};
        Err ->
            Err
    end.

%% @doc Verifies a MIC token which has been received alongside the given
%% message.
-spec verify_mic(message(), token(), state()) ->
    {ok, state()} |
    gss_mechanism:per_msg_error() |
    gss_mechanism:fatal_error().
verify_mic(Message, Token, S0 = #?MODULE{state = running,
                                         mechmod = Mod, mechstate = MS0}) ->
    case Mod:verify_mic(Message, Token, MS0) of
        {ok, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, S1};
        {error, Err, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {error, Err, S1};
        Err ->
            Err
    end.

%% @doc Retrieves the local party's name in the GSS context.
-spec local_name(state()) ->
    {ok, gss_mechanism:internal_name()} |
    {error, not_yet_available}.
local_name(#?MODULE{state = running, mechmod = Mod, mechstate = MS0}) ->
    Mod:local_name(MS0).

%% @doc Retrieves the remote (peer) party's authenticated name in the GSS
%% context.
-spec peer_name(state()) ->
    {ok, gss_mechanism:internal_name()} |
    {error, not_yet_available}.
peer_name(#?MODULE{state = running, mechmod = Mod, mechstate = MS0}) ->
    Mod:peer_name(MS0).

%% @doc Translates a name into a more useful generalised form.
-spec translate_name(gss_mechanism:internal_name(), gss_mechanism:oid() | any) ->
    {ok, gss_mechanism:display_name()} |
    {error, bad_name} |
    {error, bad_target_oid}.
translate_name(Name, Oid) ->
    MechMods = maps:values(?mechs),
    translate_name(Name, Oid, MechMods).

translate_name(Name, Oid, [MechMod]) ->
    case MechMod:translate_name(Name, Oid) of
        {ok, DisplayName} -> {ok, DisplayName};
        Err -> Err
    end;
translate_name(Name, Oid, [MechMod | Rest]) ->
    case MechMod:translate_name(Name, Oid) of
        {ok, DisplayName} -> {ok, DisplayName};
        {error, _} -> translate_name(Name, Oid, Rest)
    end.

%% @doc Destroys a GSS context, producing a token informing the other party
%% (if the mechanism supports it).
-spec delete(state()) ->
    {ok, token()} |
    ok |
    gss_mechanism:fatal_error().
delete(#?MODULE{state = running, mechmod = Mod, mechstate = MS0}) ->
    Mod:delete(MS0).

%% @doc Used to call a mechanism-specific method against the internal state
%% of the mechanism SPNEGO negotiated.
-spec mech_specific(module(), fun(), [term()], gss_mechanism:state()) ->
    {ok, gss_mechanism:state()} |
    {ok, term(), gss_mechanism:state()} |
    gss_mechanism:fatal_error().
mech_specific(Mod, Fun, Args, S0 = #?MODULE{mechmod = Mod, mechstate = MS0}) ->
    case erlang:apply(Mod, Fun, Args ++ [MS0]) of
        {ok, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, S1};
        {ok, Result, MS1} ->
            S1 = S0#?MODULE{mechstate = MS1},
            {ok, Result, S1};
        Err ->
            Err
    end;
mech_specific(Mod, _Fun, _Args, _S0 = #?MODULE{mechmod = OtherMod})
                                                    when Mod =/= OtherMod ->
    {error, bad_mech}.
