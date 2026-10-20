%% ACS patch: this module is not in upstream kerlberos. See FORK.md.
%%
%% Redaction for format_status/1, so passwords, keytabs, keys and tickets
%% stay out of crash reports and sys:get_status/1.

-module(krb_redact).

-export([
    config/1,
    key/1,
    ticket_result/1,
    message/1,
    reason/1
    ]).

%% Config keys that hold a password, a keytab or a ticket.
-define(SECRET_KEYS, [secret, keytab, tgt]).

-spec config(term()) -> term().
config(C) when is_map(C) ->
    maps:map(fun (K, V) ->
        case lists:member(K, ?SECRET_KEYS) of
            true -> redacted;
            false -> V
        end
    end, C);
config(C) ->
    C.

-spec key(term()) -> undefined | redacted.
key(undefined) -> undefined;
key(_Key) -> redacted.

%% A ticket includes its session key.
-spec ticket_result(term()) -> term().
ticket_result({ok, _Ticket}) -> {ok, redacted};
ticket_result(Result) -> Result.

%% The last message a krb_realm process received.
-spec message(term()) -> term().
message({'$gen_call', From, Request}) ->
    {'$gen_call', From, message(Request)};
message({authenticate, Principal, _Secret, Opts}) ->
    {authenticate, Principal, redacted, config(Opts)};
message({obtain_ticket, _TGT, Principal, Opts}) ->
    {obtain_ticket, redacted, Principal, Opts};
message(Message) ->
    Message.

%% An exit reason can hold anything a crashed function was called with,
%% including the process's state. Keep the kind of error and where it
%% happened, but not the terms.
-spec reason(term()) -> term().
reason(Reason) when is_atom(Reason) ->
    Reason;
reason({Why, Stack}) when is_list(Stack) ->
    {reason(Why), [frame(F) || F <- Stack]};
reason(Reason) when is_tuple(Reason), tuple_size(Reason) > 0,
                    is_atom(element(1, Reason)) ->
    element(1, Reason);
reason(_Reason) ->
    redacted.

frame({M, F, Args, Location}) when is_list(Args) ->
    {M, F, length(Args), Location};
frame(Frame) ->
    Frame.
