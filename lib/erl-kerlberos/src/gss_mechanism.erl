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

-module(gss_mechanism).

-include("SPNEGO.hrl").

-export_type([
    token/0, state/0, message/0, options/0, general_options/0,
    reason/0, oid/0, general_oid/0, internal_name/0, display_name/0,
    fatal_error/0, per_msg_error/0
    ]).

-type state() :: term().
%% Opaque state managed by the gss mechanism module.

-type token() :: binary().
%% A token to be transported (or which has been transported) across the
%% connection.

-type message() :: binary().
%% An unwrapped plain-text application message.

-type mech_specific_options() :: #{}.
%% Mechanisms may support specific local options in the options map.

-type mech_specific_chan_bindings() :: term().
%% Mechanisms may support other formats for channel bindings.

-type general_options() :: #{
    chan_bindings => binary() | gss_bindings:rfc2744() |
        mech_specific_chan_bindings(),
    delegate => boolean(),
    mutual_auth => boolean(),
    sequence => boolean(),
    replay_detect => boolean(),
    confidentiality => boolean(),
    integrity => boolean()
    }.
%% General options accepted by all mechanisms.

-type options() :: general_options() | mech_specific_options().

-type reason() :: defective_token | defective_cred | bad_mic | no_cred |
    bad_mech | cred_expired | bad_bindings | old_token | duplicate_token |
    bad_state | bad_name | context_expired | unseq_token | gap_token | term().

-type per_msg_error() :: {error, reason(), state()}.
%% An error which affects only the current message/token and does not abort the
%% context.
-type fatal_error() :: {error, reason()} | {error, {reason(), term()}}.
%% An error which aborts the context.

-type hbsn_oid() :: hbsn | svchost | ?'id-service-name'.
-type hbsn_name() :: string().
%% GSS_C_NT_HOSTBASED_SERVICE: "service@hostname"

-type username_oid() :: username | ?'id-user-name'.
-type username_name() :: string().
%% GSS_C_NT_USER_NAME: "username"

-type uid_oid() :: machine_uid | ?'id-string-uid-name'.
-type uid_name() :: string().
%% GSS_C_NT_STRING_UID_NAME: "12345"

-type general_oid() :: hbsn_oid() | username_oid() | uid_oid().
-type mech_specific_oid() :: tuple().
-type oid() :: general_oid() | mech_specific_oid().
-type internal_name() :: term().
-type display_name() ::
    {hbsn_oid(), hbsn_name()} |
    {username_oid(), username_name()} |
    {uid_oid() | uid_name()} |
    {oid(), string()}.

%% Begins a new GSS context as the initiator (connecting) party.
%%
%% If returning <code>{ok, token(), state()}</code>, then the <code>token</code>
%% is the last token in the setup flow (and after transporting it to the
%% acceptor, applications should begin calling <code>get_mic/2</code> and
%% <code>wrap/2</code>).
%%
%% If returning <code>{continue, token(), state()}</code>, the mechanism expects
%% a reply to the given token first, which should be given to
%% <code>continue/2</code>.
-callback initiate(options()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    fatal_error().

%% Begins a new GSS context as the acceptor (listening) party.
%%
%% If returning <code>{ok, token(), state()}</code>, then the <code>token</code>
%% is the last token in the setup flow (and after transporting it to the
%% initiator, applications should begin calling <code>get_mic/2</code> and
%% <code>wrap/2</code>).
%%
%% If returning <code>{continue, token(), state()}</code>, the mechanism expects
%% a reply to the given token first, which should be given to
%% <code>continue/2</code>.
-callback accept(token(), options()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    fatal_error().

%% Continues an initiate() or accept() operation with a new token from the other
%% party.
%%
%% Return values have the same meaning as in <code>initiate/1</code> or
%% <code>accept/2</code>.
-callback continue(token(), state()) ->
    {ok, token(), state()} |
    {continue, token(), state()} |
    {ok, state()} |
    fatal_error().

%% Destroys a GSS context, producing a token informing the other party (if the
%% mechanism supports it).
-callback delete(state()) ->
    {ok, token()} |
    ok |
    fatal_error().

%% Computes a MIC (Message Integrity Check) token for a given message. A MIC
%% token should be transported to the other party alongside the message so
%% that they may check its integrity (the token does not contain the message).
-callback get_mic(message(), state()) ->
    {ok, token(), state()} |
    fatal_error().
%% Verifies a MIC token which has been received alongside the given message.
-callback verify_mic(message(), token(), state()) ->
    {ok, state()} |
    per_msg_error() |
    fatal_error().

%% Wraps a message into a token, which may encrypt and checksum it as needed
%% (depending on mechanism and the options given). A Wrap Token should be
%% transported to the other party without any additional information.
-callback wrap(message(), state()) ->
    {ok, token(), state()} |
    fatal_error().
%% Validates and unpacks a Wrap token which has been received, returning the
%% enclosed message.
-callback unwrap(token(), state()) ->
    {ok, message(), state()} |
    per_msg_error() |
    fatal_error().

%% Retrieves the local party's name in the GSS context.
-callback local_name(state()) ->
    {ok, internal_name()} |
    {error, not_yet_available}.
%% Retrieves the remote (peer) party's authenticated name in the GSS context.
-callback peer_name(state()) ->
    {ok, internal_name()} |
    {error, not_yet_available}.

%% Translates a name into a more useful generalised form.
-callback translate_name(internal_name(), oid() | any) ->
    {ok, display_name()} |
    {error, bad_name} |
    {error, bad_target_oid}.
