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
-module(krb_proto).

-compile([{parse_transform, lager_transform}]).

-include("krb_key_records.hrl").
-include("KRB5.hrl").

-export_type([
    ticket/0,
    kdc_flag/0,
    ticket_flag/0,
    keyset/0
    ]).

-export([
    datetime_to_krbtime/1,
    system_time_to_krbtime/2,
    encode_kdc_flags/1,
    decode_kdc_flags/1,
    encode_ticket_flags/1,
    decode_ticket_flags/1,
    decode/2,
    encode/2,
    decrypt/3,
    encrypt/3,
    checksum/3,
    ticket_from_rep/2,
    make_generic_error/3,
    make_error/3
    ]).

% for internal use
-export_type([flag/0, bit_flags/0]).
-export([decode_bit_flags/2, encode_bit_flags/2]).

make_generic_error(Realm, Service, Why) ->
    E0 = make_error(Realm, Service, 'KRB_ERR_GENERIC'),
    E0#'KRB-ERROR'{
        'e-text' = iolist_to_binary([io_lib:format("~9999p", [Why])])
    }.

make_error(Realm, Service, Code) ->
    NowUSec = erlang:system_time(microsecond),
    NowMSec = NowUSec div 1000,
    USec = NowUSec rem 1000,
    NowKrb = krb_proto:system_time_to_krbtime(NowMSec, millisecond),
    #'KRB-ERROR'{
        pvno = 5,
        'msg-type' = 30,
        stime = NowKrb,
        susec = USec,
        realm = Realm,
        sname = #'PrincipalName'{'name-type' = 2, 'name-string' = Service},
        'error-code' = Code
    }.

-type realm() :: string().

-type ticket() :: #{
    flags => [ticket_flag()],
    authtime => krbtime(),
    starttime => krbtime(),
    endtime => krbtime(),
    renewuntil => krbtime(),
    realm => realm(),
    principal => [string()],
    svc_realm => realm(),
    svc_principal => [string()],
    key => krb_crypto:base_key(),
    ticket => #'Ticket'{}}.

-type reply() :: #'KDC-REP'{'enc-part' :: #'EncKDCRepPart'{}}.

-spec ticket_from_rep([string()], reply()) -> ticket().
ticket_from_rep(Princ, KR = #'KDC-REP'{ticket = T, 'enc-part' = EP = #'EncKDCRepPart'{}}) ->
    #'KDC-REP'{crealm = CRealm, cname = CName} = KR,
    #'EncKDCRepPart'{key = Key, flags = Flags, authtime = AuthTime,
                     endtime = EndTime, srealm = SRealm, sname = SName} = EP,
    #'PrincipalName'{'name-type' = 2, 'name-string' = SvcPrinc} = SName,
    #'PrincipalName'{'name-type' = 1, 'name-string' = TktPrinc} = CName,
    TktPrincNorm = [unicode:characters_to_binary(X, utf8) || X <- TktPrinc],
    PrincNorm = [unicode:characters_to_binary(X, utf8) || X <- Princ],
    TktPrincNorm = PrincNorm,
    T0 = #{
        key => Key,
        ticket => T,
        flags => sets:to_list(Flags),
        authtime => iolist_to_binary([AuthTime]),
        endtime => iolist_to_binary([EndTime]),
        realm => CRealm,
        principal => Princ,
        svc_realm => SRealm,
        svc_principal => SvcPrinc
    },
    T1 = case EP of
        #'EncKDCRepPart'{starttime = asn1_NOVALUE} ->
            T0;
        #'EncKDCRepPart'{starttime = STime} ->
            T0#{starttime => iolist_to_binary([STime])}
    end,
    _T2 = case EP of
        #'EncKDCRepPart'{'renew-till' = asn1_NOVALUE} ->
            T1;
        #'EncKDCRepPart'{'renew-till' = RenewUntil} ->
            T0#{renewuntil => iolist_to_binary([RenewUntil])}
    end.

-define(kdc_flags, [
    skip,forwardable,forwarded,proxiable,
    proxy,allow_postdate,postdated,skip,
    renewable,pk_cross,skip,hw_auth,
    {skip,3},canonicalize,
    {skip,8},
    {skip,2},disable_transited,renewable_ok,
    enc_tkt_in_skey,skip,renew,validate]).

-define(ticket_flags, [
    skip,forwardable,forwarded,proxiable,
    proxy,allow_postdate,postdated,invalid,
    renewable,initial,pre_auth,hw_auth,
    transited,delegate,skip,skip,
    anonymous,skip,skip,skip,
    {skip,12}]).

-define(ap_flags, [
    {skip,2}, use_subkey, etype_negotiate, {skip, 4},
    {skip,16},
    {skip,5}, mutual, use_session_key, skip]).

-type kdc_flag() :: forwardable | forwarded | proxiable | proxy |
    allow_postdate | postdated | renewable | pk_cross | hw_auth |
    canonicalize | disable_transited | renewable_ok | enc_tkt_in_skey |
    renew | validate.
-type ticket_flag() :: forwardable | forwarded | proxiable | proxy |
    allow_postdate | postdated | invalid | renewable | initial | pre_auth |
    hw_auth | transited | delegate | anonymous.

-spec encode_kdc_flags(sets:set(kdc_flag())) -> bitstring().
encode_kdc_flags(FlagSet) ->
    encode_bit_flags(FlagSet, ?kdc_flags).
-spec decode_kdc_flags(bitstring()) -> sets:set(kdc_flag()).
decode_kdc_flags(Bitstring) ->
    decode_bit_flags(Bitstring, ?kdc_flags).
-spec encode_ticket_flags(sets:set(ticket_flag())) -> bitstring().
encode_ticket_flags(FlagSet) ->
    encode_bit_flags(FlagSet, ?ticket_flags).
-spec decode_ticket_flags(bitstring()) -> sets:set(ticket_flag()).
decode_ticket_flags(Bitstring) ->
    decode_bit_flags(Bitstring, ?ticket_flags).

decode(_Data, []) -> {error, not_decoded};
decode(Data, [NextType | Rest]) ->
    case 'KRB5':decode(NextType, Data) of
        {ok, Record0, Leftover} ->
            case Leftover of
                <<>> -> ok;
                _ ->
                    lager:debug("garbage after asn.1 decoding (~p): ~p",
                        [NextType, Leftover])
            end,
            Record1 = post_decode(Record0),
            {ok, Record1};
        _ ->
            decode(Data, Rest)
    end.

post_decode(A = #'Authenticator'{subkey = K = #'EncryptionKey'{}}) ->
    post_decode(A#'Authenticator'{subkey = post_decode(K)});
post_decode(T = #'Ticket'{'enc-part' = EP}) ->
    T#'Ticket'{'enc-part' = post_decode(EP)};
post_decode(T = #'EncTicketPart'{flags = F0, key = K0}) when is_bitstring(F0) ->
    F1 = decode_bit_flags(F0, ?ticket_flags),
    K1 = post_decode(K0),
    T#'EncTicketPart'{flags = F1, key = K1};
post_decode(APR = #'AP-REQ'{'ap-options' = B, ticket = T, authenticator = A}) when is_bitstring(B) ->
    Opts = decode_bit_flags(B, ?ap_flags),
    post_decode(APR#'AP-REQ'{'ap-options' = Opts, ticket = post_decode(T),
        authenticator = post_decode(A)});
post_decode(Pa = #'PA-DATA'{'padata-type' = 11, 'padata-value' = V0}) ->
    case 'KRB5':decode('ETYPE-INFO', V0) of
        {ok, V1, <<>>} -> Pa#'PA-DATA'{'padata-value' = V1};
        _ -> Pa
    end;
post_decode(Pa = #'PA-DATA'{'padata-type' = 19, 'padata-value' = V0}) ->
    case 'KRB5':decode('ETYPE-INFO2', V0) of
        {ok, V1, <<>>} -> Pa#'PA-DATA'{'padata-value' = V1};
        _ -> Pa
    end;
post_decode(E = #'KRB-ERROR'{'error-code' = I}) when is_integer(I) ->
    IC = krb_errors:err_to_atom(I),
    post_decode(E#'KRB-ERROR'{'error-code' = IC});
post_decode(E = #'KRB-ERROR'{'e-data' = D0}) when is_binary(D0) ->
    case 'KRB5':decode('METHOD-DATA', D0) of
        {ok, D1, <<>>} ->
            D2 = [post_decode(Pa) || Pa <- D1],
            E#'KRB-ERROR'{'e-data' = D2};
        _ ->
            E
    end;
post_decode(R = #'KDC-REP'{'enc-part' = EP, ticket = T}) ->
    R#'KDC-REP'{'enc-part' = post_decode(EP), ticket = post_decode(T)};
post_decode(R = #'AP-REP'{'enc-part' = EP}) ->
    R#'AP-REP'{'enc-part' = post_decode(EP)};
post_decode(EP = #'EncryptedData'{etype = ETI}) when is_integer(ETI) ->
    ET = krb_crypto:etype_to_atom(ETI),
    post_decode(EP#'EncryptedData'{etype = ET});
post_decode(R = #'EncAPRepPart'{subkey = EK}) ->
    R#'EncAPRepPart'{subkey = post_decode(EK)};
post_decode(R = #'EncKDCRepPart'{flags = FlagsBin}) when is_binary(FlagsBin) ->
    Flags = decode_bit_flags(FlagsBin, ?ticket_flags),
    post_decode(R#'EncKDCRepPart'{flags = Flags});
post_decode(R = #'EncKDCRepPart'{key = EK}) ->
    R#'EncKDCRepPart'{key = post_decode(EK)};
post_decode(#'EncryptionKey'{keytype = ETI, keyvalue = KV}) when is_integer(ETI) ->
    ET = krb_crypto:etype_to_atom(ETI),
    #krb_base_key{etype = ET, key = KV};
post_decode(S) -> S.

find_key(ET, [#{key := K = #krb_base_key{etype = ET}} | _]) -> K;
find_key(ET, [K = #krb_base_key{etype = ET} | _]) -> K;
find_key(ET, K = #krb_base_key{etype = ET}) -> K;
find_key(ET, [_ | Rest]) -> find_key(ET, Rest);
find_key(_ET, _Ks) -> no_key_found.

-type keyset() ::
    krb_crypto:base_key() |
    [krb_crypto:base_key()] |
    [krb_mit_keytab:keytab_entry()].

-spec decrypt(keyset(), krb_crypto:usage(), encrypted()) -> {ok, decrypted()} | {error, term()}.
decrypt(Ks, Usage, #'EncryptedData'{etype = EType, cipher = CT}) ->
    case find_key(EType, Ks) of
        no_key_found ->
            {error, {no_key_found, EType}};
        K ->
            case (catch krb_crypto:decrypt(K, CT, #{usage => Usage})) of
                {'EXIT', Why} ->
                    {error, Why};
                Plain ->
                    {ok, Plain}
            end
    end;
decrypt(Ks, Usage, R0 = #'KDC-REP'{'enc-part' = EP}) ->
    case decrypt(Ks, Usage, EP) of
        {ok, Plain} ->
            case (catch inner_decode_tgs_or_as(Plain)) of
                {'EXIT', Why} ->
                    {error, {inner_decode, Why}};
                Inner ->
                    R1 = R0#'KDC-REP'{'enc-part' = Inner},
                    {ok, R1}
            end;
        Err -> Err
    end;
decrypt(Ks, Usage, R0 = #'AP-REP'{'enc-part' = EP}) ->
    case decrypt(Ks, Usage, EP) of
        {ok, Plain} ->
            case (catch inner_decode('EncAPRepPart', Plain)) of
                {'EXIT', Why} ->
                    {error, {inner_decode, Why}};
                Inner ->
                    R1 = R0#'AP-REP'{'enc-part' = Inner},
                    {ok, R1}
            end;
        Err -> Err
    end;
decrypt(Ks, Usage, R0 = #'AP-REQ'{'authenticator' = EP}) ->
    case decrypt(Ks, Usage, EP) of
        {ok, Plain} ->
            case (catch inner_decode_authenticator(Plain)) of
                {'EXIT', Why} ->
                    {error, {inner_decode, Why}};
                Inner ->
                    R1 = R0#'AP-REQ'{'authenticator' = Inner},
                    {ok, R1}
            end;
        Err -> Err
    end;
decrypt(Ks, Usage, R0 = #'Ticket'{'enc-part' = EP}) ->
    case decrypt(Ks, Usage, EP) of
        {ok, Plain} ->
            case (catch inner_decode_ticket(Plain)) of
                {'EXIT', Why} ->
                    {error, {inner_decode, Why}};
                Inner ->
                    R1 = R0#'Ticket'{'enc-part' = Inner},
                    {ok, R1}
            end;
        Err -> Err
    end.

inner_decode(Type, Bin) ->
    case 'KRB5':decode(Type, Bin) of
        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
            <<0:(bit_size(Rem))>> = Rem,
            post_decode(EncPart);
        Err ->
            error({bad_inner_data, Type, Err})
    end.

inner_decode_ticket(Bin) ->
    case 'KRB5':decode('EncTicketPart', Bin) of
        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
            <<0:(bit_size(Rem))>> = Rem,
            post_decode(EncPart);
        _ ->
            case Bin of
                <<16#A0, 7, 3, 5, _/binary>> ->
                    % encticketpart without the app 3 seq tags
                    Len = asn1_encode_length(byte_size(Bin)),
                    WithSeq = <<16#30, Len/binary, Bin/binary>>,
                    Len2 = asn1_encode_length(byte_size(WithSeq)),
                    WithApp = <<16#63, Len2/binary, WithSeq/binary>>,
                    case 'KRB5':decode('EncTicketPart', WithApp) of
                        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
                            <<0:(bit_size(Rem))>> = Rem,
                            post_decode(EncPart);
                        _ ->
                            error({bad_inner_data, 'EncTicketPart'})
                    end;
                _ ->
                    error({bad_inner_data, 'EncTicketPart'})
            end
    end.

inner_decode_authenticator(Bin) ->
    case 'KRB5':decode('Authenticator', Bin) of
        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
            <<0:(bit_size(Rem))>> = Rem,
            post_decode(EncPart);
        _ ->
            case Bin of
                <<2,1,5,_/binary>> ->
                    % authenticator vno without the app 2 seq tag
                    % MS krb5 often produces this (and things being compatible
                    % with it)
                    % reconstruct the front part that's missing
                    IntTagged = <<16#A0, 16#03, Bin/binary>>,
                    % then the sequence tag to go on the very front
                    Len = asn1_encode_length(byte_size(IntTagged)),
                    WithSeq = <<16#30, Len/binary, IntTagged/binary>>,
                    Len2 = asn1_encode_length(byte_size(WithSeq)),
                    WithApp = <<16#62, Len2/binary, WithSeq/binary>>,
                    case 'KRB5':decode('Authenticator', WithApp) of
                        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
                            <<0:(bit_size(Rem))>> = Rem,
                            post_decode(EncPart);
                        _ ->
                            error({bad_inner_data, 'Authenticator'})
                    end;
                _ ->
                    error({bad_inner_data, 'Authenticator'})
            end
    end.

-spec inner_decode_tgs_or_as(binary()) -> #'EncKDCRepPart'{}.
inner_decode_tgs_or_as(Bin) ->
    case 'KRB5':decode('EncTGSRepPart', Bin) of
        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
            <<0:(bit_size(Rem))>> = Rem,
            post_decode(EncPart);
        _ ->
            inner_decode_as(Bin)
    end.

inner_decode_as(Bin) ->
    case 'KRB5':decode('EncASRepPart', Bin) of
        {ok, EncPart, Rem} when byte_size(Rem) < 8 ->
            <<0:(bit_size(Rem))>> = Rem,
            post_decode(EncPart);

        _ ->
            % HACK ALERT
            % microsoft's older krb5 implementations often chop off the front
            % of the EncASRepPart. what you get is just its innards starting
            % with an un-tagged EncryptionKey
            {ok, #'EncryptionKey'{}, B} = 'KRB5':decode('EncryptionKey', Bin),

            % reconstruct the front part that's missing -- first, the context
            % #0 tag for EncryptionKey
            LenBytes = asn1_encode_length(byte_size(Bin) - byte_size(B)),
            All = <<1:1, 0:1, 1:1, 0:5, LenBytes/binary, Bin/binary>>,
            % then the sequence tag to go on the very front
            LenBytes2 = asn1_encode_length(byte_size(All)),
            Plain2 = <<0:1, 0:1, 1:1, 16:5,
                       LenBytes2/binary, All/binary>>,

            % don't bother reconstructing the application tag for EncASRepPart,
            % just decode it here as a plain EncKDCRepPart
            {ok, EncPart, <<>>} = 'KRB5':decode('EncKDCRepPart', Plain2),
            post_decode(EncPart)
    end.

-type encrypted() ::
    #'EncryptedData'{} |
    #'KDC-REP'{'enc-part' :: #'EncryptedData'{}} |
    #'AP-REP'{'enc-part' :: #'EncryptedData'{}} |
    #'AP-REQ'{'authenticator' :: #'EncryptedData'{}} |
    #'Ticket'{'enc-part' :: #'EncryptedData'{}} |
    #'PA-DATA'{'padata-value' :: binary()}.
-type decrypted() ::
    binary() |
    #'KDC-REP'{'enc-part' :: #'EncKDCRepPart'{}} |
    #'AP-REP'{'enc-part' :: #'EncAPRepPart'{}} |
    #'AP-REQ'{'authenticator' :: #'Authenticator'{}} |
    #'Ticket'{'enc-part' :: #'EncTicketPart'{}} |
    #'PA-DATA'{'padata-value' :: #'PA-ENC-TS-ENC'{}}.

-spec encrypt(krb_crypto:base_key(), krb_crypto:usage(), decrypted()) -> encrypted().
encrypt(K, Usage, R0 = #'AP-REQ'{authenticator = A}) ->
    #krb_base_key{etype = EType} = K,
    {ok, Plaintext} = encode('Authenticator', A),
    Ciphertext = krb_crypto:encrypt(K, Plaintext, #{usage => Usage}),
    ED = #'EncryptedData'{
        etype = krb_crypto:atom_to_etype(EType),
        cipher = Ciphertext
    },
    R0#'AP-REQ'{authenticator = ED};
encrypt(K, Usage, R0 = #'AP-REP'{'enc-part' = #'EncAPRepPart'{} = EP}) ->
    #krb_base_key{etype = EType} = K,
    {ok, Plaintext} = encode('EncAPRepPart', EP),
    Ciphertext = krb_crypto:encrypt(K, Plaintext, #{usage => Usage}),
    ED = #'EncryptedData'{
        etype = krb_crypto:atom_to_etype(EType),
        cipher = Ciphertext
    },
    R0#'AP-REP'{'enc-part' = ED};
encrypt(K, Usage, R0 = #'PA-DATA'{'padata-value' = V0 = #'PA-ENC-TS-ENC'{}}) ->
    #krb_base_key{etype = EType} = K,
    {ok, Plaintext} = encode('PA-ENC-TS-ENC', V0),
    Ciphertext = krb_crypto:encrypt(K, Plaintext, #{usage => Usage}),
    ED = #'EncryptedData'{
        etype = krb_crypto:atom_to_etype(EType),
        cipher = Ciphertext
    },
    {ok, V1} = encode('EncryptedData', ED),
    R0#'PA-DATA'{'padata-type' = 2, 'padata-value' = V1};
encrypt(K, Usage, R0 = #'Ticket'{'enc-part' = #'EncTicketPart'{} = EP}) ->
    #krb_base_key{etype = EType} = K,
    {ok, Plaintext} = encode('EncTicketPart', EP),
    Ciphertext = krb_crypto:encrypt(K, Plaintext, #{usage => Usage}),
    ED = #'EncryptedData'{
        etype = krb_crypto:atom_to_etype(EType),
        cipher = Ciphertext
    },
    R0#'Ticket'{'enc-part' = ED}.

-spec checksum(krb_crypto:ck_key(), krb_crypto:usage(), #'KDC-REQ-BODY'{} | binary()) -> #'Checksum'{}.
checksum(CK, Usage, B = #'KDC-REQ-BODY'{}) ->
    #krb_ck_key{ctype = CType} = CK,
    {ok, Bin} = encode('KDC-REQ-BODY', B),
    #'Checksum'{
        cksumtype = krb_crypto:atom_to_ctype(CType),
        checksum = krb_crypto:checksum(CK, Bin, #{usage => Usage})
    };
checksum(CK, Usage, Bin) when is_binary(Bin) ->
    #krb_ck_key{ctype = CType} = CK,
    #'Checksum'{
        cksumtype = krb_crypto:atom_to_ctype(CType),
        checksum = krb_crypto:checksum(CK, Bin, #{usage => Usage})
    }.

asn1_encode_length(L) when L =< 127 ->
    <<L>>;
asn1_encode_length(L) ->
    Bytes = binary:encode_unsigned(L),
    <<1:1, (byte_size(Bytes)):7, Bytes/binary>>.

pre_encode(T = #'EncTicketPart'{flags = F0, key = K0}) ->
    F1 = encode_bit_flags(F0, ?ticket_flags),
    K1 = pre_encode(K0),
    T#'EncTicketPart'{flags = F1, key = K1};
pre_encode(RP = #'EncAPRepPart'{subkey = K}) ->
    RP#'EncAPRepPart'{subkey = pre_encode(K)};
pre_encode(T = #'Ticket'{'enc-part' = EP}) ->
    T#'Ticket'{'enc-part' = pre_encode(EP)};
pre_encode(E = #'KRB-ERROR'{'error-code' = A}) when is_atom(A) ->
    I = krb_errors:atom_to_err(A),
    pre_encode(E#'KRB-ERROR'{'error-code' = I});
pre_encode(APR = #'AP-REQ'{'ap-options' = B, ticket = T, authenticator = A}) when is_bitstring(B) ->
    APR#'AP-REQ'{ticket = pre_encode(T), authenticator = pre_encode(A)};
pre_encode(APR = #'AP-REQ'{'ap-options' = Set, ticket = T, authenticator = A}) ->
    Bits = encode_bit_flags(Set, ?ap_flags),
    APR#'AP-REQ'{'ap-options' = Bits, ticket = pre_encode(T),
        authenticator = pre_encode(A)};
pre_encode(PA = #'PA-DATA'{'padata-value' = V0 = #'AP-REQ'{}}) ->
    {ok, D} = encode('AP-REQ', V0),
    PA#'PA-DATA'{'padata-type' = 1, 'padata-value' = D};
pre_encode(PA = #'PA-DATA'{'padata-value' = V0 = #'PA-PAC-REQUEST'{}}) ->
    {ok, D} = encode('PA-PAC-REQUEST', V0),
    PA#'PA-DATA'{'padata-type' = 128, 'padata-value' = D};
pre_encode(R = #'KDC-REQ-BODY'{etype = ETs}) ->
    ETIs = lists:map(fun
        (I) when is_integer(I) -> I;
        (A) when is_atom(A) -> krb_crypto:atom_to_etype(A)
    end, ETs),
    R#'KDC-REQ-BODY'{etype = ETIs};
pre_encode(R = #'KDC-REQ'{padata = PAs, 'req-body' = Body}) ->
    R#'KDC-REQ'{padata = [pre_encode(PA) || PA <- PAs],
                'req-body' = pre_encode(Body)};
pre_encode(A = #'Authenticator'{subkey = K0 = #krb_base_key{}}) ->
    pre_encode(A#'Authenticator'{subkey = pre_encode(K0)});
pre_encode(A = #'Authenticator'{cksum = C = #'Checksum'{cksumtype = CK}}) when is_atom(CK) ->
    pre_encode(A#'Authenticator'{cksum = pre_encode(C)});
pre_encode(C = #'Checksum'{cksumtype = CK}) when is_atom(CK) ->
    CKI = krb_crypto:atom_to_ctype(CK),
    pre_encode(C#'Checksum'{cksumtype = CKI});
pre_encode(ED = #'EncryptedData'{etype = ET}) when is_atom(ET) ->
    ED#'EncryptedData'{etype = krb_crypto:atom_to_etype(ET)};
pre_encode(#krb_base_key{etype = ET, key = K}) ->
    #'EncryptionKey'{
        keytype = krb_crypto:atom_to_etype(ET),
        keyvalue = K};
pre_encode(X) -> X.

encode(Type, Data) ->
    'KRB5':encode(Type, pre_encode(Data)).

-type krbtime() :: binary().

-spec datetime_to_krbtime(datetime:datetime()) -> krbtime().
datetime_to_krbtime({{Y, M, D}, {Hr, Min, Sec}}) ->
    iolist_to_binary(io_lib:format("~4..0B~2..0B~2..0B~2..0B~2..0B~2..0BZ",
        [Y, M, D, Hr, Min, Sec])).

-type unit() :: atom().
-spec system_time_to_krbtime(integer(), unit()) -> krbtime().
system_time_to_krbtime(V, U) ->
    UT = calendar:system_time_to_universal_time(V, U),
    datetime_to_krbtime(UT).


-type flag() :: atom().
-type bit_flags() :: [skip | {skip, integer()} | flag()].

-spec decode_bit_flags(bitstring(), bit_flags()) -> sets:set(flag()).
decode_bit_flags(<<>>, _) -> sets:new();
decode_bit_flags(Bits, [{skip,N} | RestAtoms]) ->
    <<_Flags:N, Rest/bitstring>> = Bits,
    decode_bit_flags(Rest, RestAtoms);
decode_bit_flags(<<_Flag:1, Rest/bitstring>>, [skip | RestAtoms]) ->
    decode_bit_flags(Rest, RestAtoms);
decode_bit_flags(Bits, [{FlagAtom, Width} | RestAtoms]) ->
    <<Flag:Width/little, Rest/bitstring>> = Bits,
    case Flag of
        0 -> decode_bit_flags(Rest, RestAtoms);
        1 -> sets:add_element(FlagAtom, decode_bit_flags(Rest, RestAtoms));
        N -> sets:add_element({FlagAtom, N}, decode_bit_flags(Rest, RestAtoms))
    end;
decode_bit_flags(<<Flag:1, Rest/bitstring>>, [FlagAtom | RestAtoms]) ->
    case Flag of
        1 -> sets:add_element(FlagAtom, decode_bit_flags(Rest, RestAtoms));
        0 -> decode_bit_flags(Rest, RestAtoms)
    end.

-spec encode_bit_flags(sets:set(flag()), bit_flags()) -> bitstring().
encode_bit_flags(_FlagSet, []) -> <<>>;
encode_bit_flags(FlagSet, [{skip, N} | RestAtoms]) ->
    RestBin = encode_bit_flags(FlagSet, RestAtoms),
    <<0:N, RestBin/bitstring>>;
encode_bit_flags(FlagSet, [skip | RestAtoms]) ->
    RestBin = encode_bit_flags(FlagSet, RestAtoms),
    <<0:1, RestBin/bitstring>>;
encode_bit_flags(FlagSet, [{FlagAtom, Width} | RestAtoms]) ->
    RestBin = encode_bit_flags(FlagSet, RestAtoms),
    case sets:is_element(FlagAtom, FlagSet) of
        true -> <<1:Width/little, RestBin/bitstring>>;
        false -> <<0:Width/little, RestBin/bitstring>>
    end;
encode_bit_flags(FlagSet, [FlagAtom | RestAtoms]) ->
    RestBin = encode_bit_flags(FlagSet, RestAtoms),
    case sets:is_element(FlagAtom, FlagSet) of
        true -> <<1:1, RestBin/bitstring>>;
        false -> <<0:1, RestBin/bitstring>>
    end.
