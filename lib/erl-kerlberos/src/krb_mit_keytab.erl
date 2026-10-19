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

%% @doc Functions for dealing with Kerberos keytabs.
-module(krb_mit_keytab).

-export([
    parse/1,
    file/1,
    filter_for_ticket/2
    ]).

-include("KRB5.hrl").
-include("krb_key_records.hrl").

-export_type([keytab_entry/0]).

-type keytab_entry() :: #{
    realm => string(),
    principal => [string()],
    timestamp => krb_proto:krbtime(),
    version => integer(),
    key => krb_crypto:base_key()
    }.

%% @doc Filters a keytab for keys which can be used to decrypt a given Kerberos
%%      ticket.
%%
%% Matches based on realm, principal and key version. EType matching can be
%% done by <code>krb_proto:decrypt()</code>.
-spec filter_for_ticket([keytab_entry()], #'Ticket'{}) ->
    {ok, [keytab_entry()]} | {error, not_found}.
filter_for_ticket(KeyTab, #'Ticket'{realm = Realm, sname = SvcName,
                                    'enc-part' = EP}) ->
    #'EncryptedData'{kvno = Version} = EP,
    #'PrincipalName'{'name-string' = Name} = SvcName,
    Matches = lists:filter(fun
        (#{realm := KRealm, principal := KName, version := KVersion}) when
            (KRealm =:= Realm) and (KName =:= Name) and
            (Version =:= KVersion) -> true;
        (_) -> false
    end, KeyTab),
    case Matches of
        [_ | _] -> {ok, Matches};
        _ -> {error, not_found}
    end.

%% @doc Reads and parses the given filename as an MIT-format keytab.
-spec file(string()) -> {ok, [keytab_entry()]} | {error, term()}.
file(Filename) ->
    case file:read_file(Filename) of
        {ok, Data} ->
            parse(Data);
        Err = {err, _} ->
            Err
    end.

%% @doc Parses an MIT-format keytab file.
%%
%% Returns a list of maps representing each entry in the keytab, consisting
%% of a Keberos key and associated meta-data.
-spec parse(binary()) -> {ok, [keytab_entry()]} | {error, term()}.
parse(<<5, 2, Rest/binary>>) ->
    case (catch parse_next(Rest)) of
        {'EXIT', Reason} -> {error, Reason};
        Other -> {ok, Other}
    end;
parse(<<5, N, _/binary>>) ->
    {error, {unsupported_version, N}};
parse(_) ->
    {error, bad_format}.

parse_next(<<>>) -> [];
parse_next(<<0:32/big-signed, _/binary>>) -> [];
parse_next(<<Len:32/big-signed, _Hole:(abs(Len))/binary, Rest/binary>>)
        when (Len < 0) ->
    parse_next(Rest);
parse_next(<<Len:32/big-signed, Rec:(abs(Len))/binary, Rest/binary>>)
        when (Len > 0) ->
    {KD0, Rem0} = parse_principal(Rec),
    <<Timestamp:32/big, KeyVersion, EncType:16/big, KeyLen:16/big,
      KeyData:(KeyLen)/binary, _Padding/binary>> = Rem0,
    KD1 = KD0#{
        timestamp => krb_proto:system_time_to_krbtime(Timestamp, second),
        version => KeyVersion
    },
    ET = krb_crypto:etype_to_atom(EncType),
    Key = #krb_base_key{etype = ET, key = KeyData},
    KD2 = KD1#{key => Key},
    [KD2 | parse_next(Rest)].

parse_principal(<<Count:16/big, Rem0/binary>>) ->
    <<RealmLen:16/big, Realm:(RealmLen)/binary, Rem1/binary>> = Rem0,
    {NamePartsBin, Rem2} = parse_data(Count, Rem1),
    NameParts = [unicode:characters_to_list(P, utf8) || P <- NamePartsBin],
    <<_NameType:32/big, Rem3/binary>> = Rem2,
    {#{realm => unicode:characters_to_list(Realm, utf8),
       principal => NameParts}, Rem3}.

parse_data(0, Rem) -> {[], Rem};
parse_data(N, <<Len:16/big, Value:(Len)/binary, Rem/binary>>) ->
    {KidData, KidRem} = parse_data(N - 1, Rem),
    {[Value | KidData], KidRem}.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

parse_test() ->
    Data = base64:decode(<<"
BQIAAABXAAIAC0VYQU1QTEUuQ09NAARob3N0AA9rZGMuZXhhbXBsZS5jb20AAAABYLgU3gIAFAAg
AvHwPDfBx2I+BetqG0ZFZAuQrxlNsCH6aJkWBpa60OwAAAACAAAARwACAAtFWEFNUExFLkNPTQAE
aG9zdAAPa2RjLmV4YW1wbGUuY29tAAAAAWC4FN4CABMAEOPsmOWeFi7oI7/s6sHW8kQAAAACAAAA
VwACAAtFWEFNUExFLkNPTQAEaG9zdAAPa2RjLmV4YW1wbGUuY29tAAAAAWC4FN4CABIAIHFzt+/O
LSY8SkRc2ZFgFuY1rOW2YE7gL/5rVYtLV/apAAAAAgAAAEcAAgALRVhBTVBMRS5DT00ABGhvc3QA
D2tkYy5leGFtcGxlLmNvbQAAAAFguBTeAgARABDwSK0yTSEX9KQWegF9dycGAAAAAgAAAE8AAgAL
RVhBTVBMRS5DT00ABGhvc3QAD2tkYy5leGFtcGxlLmNvbQAAAAFguBTeAgAQABjZqDuns5vyPZ0+
aLakl6tocxXvkpcfcK4AAAACAAAARwACAAtFWEFNUExFLkNPTQAEaG9zdAAPa2RjLmV4YW1wbGUu
Y29tAAAAAWC4FN4CABcAEKT0oEIjHF3MqdGPbuEhwOAAAAACAAAAPwACAAtFWEFNUExFLkNPTQAE
aG9zdAAPa2RjLmV4YW1wbGUuY29tAAAAAWC4FN4CAAgACMcxMob3GdOeAAAAAgAAAD8AAgALRVhB
TVBMRS5DT00ABGhvc3QAD2tkYy5leGFtcGxlLmNvbQAAAAFguBTeAgADAAjlpEk3em4qvAAAAAI=">>),
    Ret = parse(Data),
    ?assertMatch({ok, [_|_]}, Ret),
    {ok, Ents} = Ret,
    ?assertMatch(["EXAMPLE.COM"],
        lists:usort([R || #{realm := R} <- Ents])),
    ?assertMatch([["host", "kdc.example.com"]],
        lists:usort([P || #{principal := P} <- Ents])),
    ?assertMatch([aes128_hmac_sha1,aes128_hmac_sha256,aes256_hmac_sha1,
                  aes256_hmac_sha384,des3_sha1,des_md5,des_sha1,rc4_hmac],
        lists:usort([ET || #{key := #krb_base_key{etype = ET}} <- Ents])).

-endif.
