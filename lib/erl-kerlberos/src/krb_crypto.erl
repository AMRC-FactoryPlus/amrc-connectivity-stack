%% kerlberos
%%
%% Copyright 2015 Alex Wilson <alex@uq.edu.au>
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

%% @doc kerberos crypto module (based on rfc3961/3962).
-module(krb_crypto).
-export([
    default_etypes/0,
    string_to_key/3,
    random_to_key/2,
    encrypt/2, encrypt/3,
    decrypt/2, decrypt/3,
    checksum/3,
    atom_to_etype/1,
    etype_to_atom/1,
    atom_to_ctype/1,
    ctype_to_atom/1,
    ctype_for_etype/1,
    base_key_to_ck_key/1,
    key_etype/1,
    key_ctype/1,
    random_to_key/1]).

-export([base_key_to_triad/2]).

-export([crc/1, crc/2, crc_unkey/3, hash_unkey/4]).

-export_type([
    etype/0,
    ctype/0,
    base_key/0,
    ck_key/0,
    usage/0]).

-type etype() :: des_crc | des_md4 | des_md5 | des3_md5 | des3_sha1 |
	aes128_hmac_sha1 | aes256_hmac_sha1 | rc4_hmac | rc4_hmac_exp |
	aes128_hmac_sha256 | aes256_hmac_sha384 | des_sha1 | des3_raw.
-type ctype() :: hmac_sha1_aes128 | hmac_sha1_aes256 | hmac_sha256_aes128 |
	hmac_sha384_aes256 | hmac_sha1_des3_kd | crc32 | sha1 | md4 | md5.

-type usage() :: as_req_pa_enc_ts | kdc_rep_ticket | as_rep_encpart |
    tgs_req_ad_sesskey | tgs_req_ad_subkey | tgs_req_auth_cksum |
    tgs_req_auth | tgs_rep_encpart_sesskey | tgs_rep_encpart_subkey |
    ap_req_auth_cksum | ap_req_auth | ap_rep_encpart | krb_priv_encpart |
    krb_cred_encpart | krb_safe_cksum | app_data_encrypt | app_data_cksum |
    krb_error_cksum | ad_kdcissued_cksum | ad_mte | ad_ite |
    gss_acceptor_seal | gss_acceptor_sign | gss_initiator_seal |
    gss_initiator_sign | gss_new_checksum | gss_3des_seal | gss_3des_sign |
    gss_3des_seq.

-spec usage_a2i(usage()) -> integer().
usage_a2i(as_req_pa_enc_ts) -> 1;
usage_a2i(kdc_rep_ticket) -> 2;
usage_a2i(as_rep_encpart) -> 3;
usage_a2i(tgs_req_ad_sesskey) -> 4;
usage_a2i(tgs_req_ad_subkey) -> 5;
usage_a2i(tgs_req_auth_cksum) -> 6;
usage_a2i(tgs_req_auth) -> 7;
usage_a2i(tgs_rep_encpart_sesskey) -> 8;
usage_a2i(tgs_rep_encpart_subkey) -> 9;
usage_a2i(ap_req_auth_cksum) -> 10;
usage_a2i(ap_req_auth) -> 11;
usage_a2i(ap_rep_encpart) -> 12;
usage_a2i(krb_priv_encpart) -> 13;
usage_a2i(krb_cred_encpart) -> 14;
usage_a2i(krb_safe_cksum) -> 15;
usage_a2i(app_data_encrypt) -> 16;
usage_a2i(app_data_cksum) -> 17;
usage_a2i(krb_error_cksum) -> 18;
usage_a2i(ad_kdcissued_cksum) -> 19;
usage_a2i(ad_mte) -> 20;
usage_a2i(ad_ite) -> 21;
usage_a2i(gss_acceptor_seal) -> 22;
usage_a2i(gss_acceptor_sign) -> 23;
usage_a2i(gss_initiator_seal) -> 24;
usage_a2i(gss_initiator_sign) -> 25;
usage_a2i(gss_des3_seal) -> 22;
usage_a2i(gss_des3_sign) -> 23;
usage_a2i(gss_des3_seq) -> 24;
usage_a2i(gss_new_checksum) -> 43;
usage_a2i(Other) -> error({bad_usage, Other}).

-spec ms_usage_a2i(usage()) -> integer().
ms_usage_a2i(as_req_pa_enc_ts) -> 1;
ms_usage_a2i(kdc_rep_ticket) -> 2;
ms_usage_a2i(as_rep_encpart) -> 8;
ms_usage_a2i(tgs_req_ad_sesskey) -> 4;
ms_usage_a2i(tgs_req_ad_subkey) -> 5;
ms_usage_a2i(tgs_req_auth_cksum) -> 6;
ms_usage_a2i(tgs_req_auth) -> 7;
ms_usage_a2i(tgs_rep_encpart_sesskey) -> 8;
ms_usage_a2i(tgs_rep_encpart_subkey) -> 9;
ms_usage_a2i(ap_req_auth_cksum) -> 10;
ms_usage_a2i(ap_req_auth) -> 11;
ms_usage_a2i(ap_rep_encpart) -> 12;
ms_usage_a2i(krb_priv_encpart) -> 13;
ms_usage_a2i(krb_cred_encpart) -> 14;
ms_usage_a2i(krb_safe_cksum) -> 15;
ms_usage_a2i(app_data_cksum) -> 0;
ms_usage_a2i(app_data_encrypt) -> 0;
ms_usage_a2i(gss_acceptor_seal) -> 0;
ms_usage_a2i(gss_acceptor_sign) -> 0;
ms_usage_a2i(gss_initiator_seal) -> 0;
ms_usage_a2i(gss_initiator_sign) -> 0;
ms_usage_a2i(gss_new_checksum) -> 0;
ms_usage_a2i(Other) -> error({bad_usage, Other}).

-include("krb_key_records.hrl").

-opaque base_key() :: #krb_base_key{}.
-opaque ck_key() :: #krb_ck_key{}.
-type protocol_key() :: {Kc :: binary(), Ke :: binary(), Ki :: binary()}.

-spec default_etypes() -> [etype()].
default_etypes() ->
    [aes256_hmac_sha384, aes128_hmac_sha256,
     aes256_hmac_sha1, aes128_hmac_sha1,
     des3_sha1, des3_md5, des_sha1,
     des_md5, des_crc,
     rc4_hmac_exp, rc4_hmac].

-spec etype_to_atom(integer()) -> etype().
etype_to_atom(1) -> des_crc;
etype_to_atom(2) -> des_md4;
etype_to_atom(3) -> des_md5;
etype_to_atom(5) -> des3_md5;
etype_to_atom(6) -> des3_raw;
etype_to_atom(8) -> des_sha1;
etype_to_atom(16) -> des3_sha1;
etype_to_atom(17) -> aes128_hmac_sha1;              % rfc3962
etype_to_atom(18) -> aes256_hmac_sha1;              % rfc3962
etype_to_atom(19) -> aes128_hmac_sha256;            % rfc8009
etype_to_atom(20) -> aes256_hmac_sha384;            % rfc8009
etype_to_atom(23) -> rc4_hmac;
etype_to_atom(24) -> rc4_hmac_exp;
etype_to_atom(N) -> error({unknown_etype, N}).

-spec atom_to_etype(etype()) -> integer().
atom_to_etype(des_crc) -> 1;
atom_to_etype(des_md4) -> 2;
atom_to_etype(des_md5) -> 3;
atom_to_etype(des3_md5) -> 5;
atom_to_etype(des3_raw) -> 6;
atom_to_etype(des_sha1) -> 8;
atom_to_etype(des3_sha1) -> 16;
atom_to_etype(aes128_hmac_sha1) -> 17;
atom_to_etype(aes256_hmac_sha1) -> 18;
atom_to_etype(aes128_hmac_sha256) -> 19;
atom_to_etype(aes256_hmac_sha384) -> 20;
atom_to_etype(rc4_hmac) -> 23;
atom_to_etype(rc4_hmac_exp) -> 24;
atom_to_etype(A) -> error({unknown_etype, A}).

-spec ctype_to_atom(integer()) -> ctype().
ctype_to_atom(1) -> crc32;
ctype_to_atom(2) -> md4;
ctype_to_atom(7) -> md5;
ctype_to_atom(10) -> sha1;
ctype_to_atom(12) -> hmac_sha1_des3_kd;
ctype_to_atom(14) -> sha1;
ctype_to_atom(15) -> hmac_sha1_aes128;
ctype_to_atom(16) -> hmac_sha1_aes256;
ctype_to_atom(19) -> hmac_sha256_aes128;
ctype_to_atom(20) -> hmac_sha384_aes256;
ctype_to_atom(-138) -> hmac_md5;
ctype_to_atom(N) -> error({unknown_ctype, N}).

-spec atom_to_ctype(ctype()) -> integer().
atom_to_ctype(crc) -> 1;
atom_to_ctype(md4) -> 2;
atom_to_ctype(md5) -> 7;
atom_to_ctype(sha1) -> 10;
atom_to_ctype(hmac_sha1_des3_kd) -> 12;
atom_to_ctype(hmac_sha1_aes128) -> 15;
atom_to_ctype(hmac_sha1_aes256) -> 16;
atom_to_ctype(hmac_sha256_aes128) -> 19;
atom_to_ctype(hmac_sha384_aes256) -> 20;
atom_to_ctype(hmac_md5) -> -138;
atom_to_ctype(A) -> error({unknown_ctype, A}).

-spec ctype_for_etype(etype()) -> ctype().
ctype_for_etype(des_crc) -> crc;
ctype_for_etype(des_md5) -> md5;
ctype_for_etype(des3_md5) -> md5;
ctype_for_etype(des3_sha1) -> hmac_sha1_des3_kd;
ctype_for_etype(aes128_hmac_sha1) -> hmac_sha1_aes128;
ctype_for_etype(aes256_hmac_sha1) -> hmac_sha1_aes256;
ctype_for_etype(aes128_hmac_sha256) -> hmac_sha256_aes128;
ctype_for_etype(aes256_hmac_sha384) -> hmac_sha384_aes256;
ctype_for_etype(rc4_hmac) -> hmac_md5;
ctype_for_etype(rc4_hmac_exp) -> hmac_md5;
ctype_for_etype(E) -> error({no_ctype_for_etype, E}).

-spec key_etype(base_key()) -> etype().
key_etype(#krb_base_key{etype = ET}) -> ET.

-spec key_ctype(ck_key()) -> ctype().
key_ctype(#krb_ck_key{ctype = CT}) -> CT.

-spec base_key_to_ck_key(base_key()) -> ck_key().
base_key_to_ck_key(#krb_base_key{etype = EType, key = Key}) ->
	#krb_ck_key{ctype = ctype_for_etype(EType), key = Key}.

-record(cryptspec, {
    encfun :: {Mod :: atom(), Fun :: atom(), Args :: [term()]},
    macfun :: {Mod :: atom(), Fun :: atom(), Args :: [term()]},
    maclen :: integer(),
    blocklen :: integer(),
    padding = false :: boolean()
    }).

-spec checksum(ck_key(), binary(), cipher_options()) -> binary().
checksum(#krb_ck_key{ctype = sha1}, Data, _Opts) ->
    crypto:hash(sha, Data);
checksum(#krb_ck_key{ctype = crc32}, Data, _Opts) ->
    crc(Data);
checksum(#krb_ck_key{ctype = md5}, Data, _Opts) ->
    crypto:hash(md5, Data);
checksum(#krb_ck_key{ctype = hmac_sha1_aes128, key = Key}, Data, Opts) ->
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    {Kc, _Ke, _Ki} = base_key_to_triad(aes128_hmac_sha1, Key, Usage),
    crypto:macN(hmac, sha, Kc, Data, 12);
checksum(#krb_ck_key{ctype = hmac_sha1_aes256, key = Key}, Data, Opts) ->
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    {Kc, _Ke, _Ki} = base_key_to_triad(aes256_hmac_sha1, Key, Usage),
    crypto:macN(hmac, sha, Kc, Data, 12);
checksum(#krb_ck_key{ctype = hmac_sha1_des3_kd, key = Key}, Data, Opts) ->
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    {Kc, _Ke, _Ki} = base_key_to_triad(des3_sha1, Key, Usage),
    crypto:macN(hmac, sha, Kc, Data, 20);
checksum(#krb_ck_key{ctype = hmac_sha256_aes128, key = Key}, Data, Opts) ->
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    {Kc, _Ke, _Ki} = base_key_to_triad(aes128_hmac_sha256, Key, Usage),
    crypto:macN(hmac, sha256, Kc, Data, 16);
checksum(#krb_ck_key{ctype = hmac_sha384_aes256, key = Key}, Data, Opts) ->
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    {Kc, _Ke, _Ki} = base_key_to_triad(aes256_hmac_sha384, Key, Usage),
    crypto:macN(hmac, sha384, Kc, Data, 24);
checksum(#krb_ck_key{ctype = hmac_md5, key = Key}, Data, Opts) ->
    T = ms_usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Ksign = crypto:mac(hmac, md5, Key, <<"signaturekey",0>>),
    Tmp = crypto:hash(md5, [<<T:32/little>>, Data]),
    crypto:mac(hmac, md5, Ksign, Tmp);
checksum(#krb_ck_key{ctype = C}, _, _) -> error({unknown_ctype, C}).

-spec encrypt(base_key(), binary()) -> binary().
encrypt(#krb_base_key{etype = EType, key = Key}, Data) ->
	one_time(EType, Key, Data, #{encrypt => true}).

-spec decrypt(base_key(), binary()) -> binary().
decrypt(#krb_base_key{etype = EType, key = Key}, Data) ->
	one_time(EType, Key, Data, #{encrypt => false}).

-type cipher_options() :: #{usage => usage()}.

-spec encrypt(base_key(), binary(), cipher_options()) -> binary().
encrypt(#krb_base_key{etype = EType, key = Key}, Data, Opts0) ->
    Opts1 = Opts0#{encrypt => true},
    one_time(EType, Key, Data, Opts1).

-spec decrypt(base_key(), binary(), cipher_options()) -> binary().
decrypt(#krb_base_key{etype = EType, key = Key}, Data, Opts0) ->
    Opts1 = Opts0#{encrypt => false},
    one_time(EType, Key, Data, Opts1).

one_time(des_crc, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_cbc]},
        macfun = {?MODULE, crc_unkey, []},
        maclen = 4, blocklen = 8, padding = true
    },
    Triad = {Key, Key, Key},
    IV = Key,
    case Opts of
        #{encrypt := true} ->
            mac_then_encrypt(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_mac_then_encrypt(Triad, IV, Data, Spec)
    end;
one_time(des_md4, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_cbc]},
        macfun = {?MODULE, hash_unkey, [md4]},
        maclen = 16, blocklen = 8, padding = true
    },
    Triad = {Key, Key, Key},
    IV = <<0:64>>,
    case Opts of
        #{encrypt := true} ->
            mac_then_encrypt(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_mac_then_encrypt(Triad, IV, Data, Spec)
    end;
one_time(des_md5, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_cbc]},
        macfun = {?MODULE, hash_unkey, [md5]},
        maclen = 16, blocklen = 8, padding = true
    },
    Triad = {Key, Key, Key},
    IV = <<0:64>>,
    case Opts of
        #{encrypt := true} ->
            mac_then_encrypt(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_mac_then_encrypt(Triad, IV, Data, Spec)
    end;
one_time(des_sha1, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_cbc]},
        macfun = {?MODULE, hash_unkey, [sha]},
        maclen = 20, blocklen = 8, padding = true
    },
    Triad = {Key, Key, Key},
    IV = <<0:64>>,
    case Opts of
        #{encrypt := true} ->
            mac_then_encrypt(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_mac_then_encrypt(Triad, IV, Data, Spec)
    end;
one_time(des3_md5, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_ede3_cbc]},
        macfun = {crypto, macN, [hmac, md5]},
        maclen = 16, blocklen = 8, padding = true
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(des3_md5, Key, Usage),
    IV = <<0:64>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_and_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_and_mac(Triad, IV, Data, Spec)
    end;
one_time(des3_sha1, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto, crypto_one_time, [des_ede3_cbc]},
        macfun = {crypto, macN, [hmac, sha]},
        maclen = 20, blocklen = 8, padding = true
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(des3_sha1, Key, Usage),
    IV = <<0:64>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_and_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_and_mac(Triad, IV, Data, Spec)
    end;
one_time(aes128_hmac_sha1, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto_cts, one_time, [aes_128_cbc]},
        macfun = {crypto, macN, [hmac, sha]},
        maclen = 12, blocklen = 16
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(aes128_hmac_sha1, Key, Usage),
    IV = <<0:128>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_and_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_and_mac(Triad, IV, Data, Spec)
    end;
one_time(aes256_hmac_sha1, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto_cts, one_time, [aes_256_cbc]},
        macfun = {crypto, macN, [hmac, sha]},
        maclen = 12, blocklen = 16
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(aes256_hmac_sha1, Key, Usage),
    IV = <<0:128>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_and_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_and_mac(Triad, IV, Data, Spec)
    end;
one_time(aes128_hmac_sha256, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto_cts, one_time, [aes_128_cbc]},
        macfun = {crypto, macN, [hmac, sha256]},
        maclen = 16, blocklen = 16
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(aes128_hmac_sha256, Key, Usage),
    IV = <<0:128>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_then_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_then_mac(Triad, IV, Data, Spec)
    end;
one_time(aes256_hmac_sha384, Key, Data, Opts) ->
    Spec = #cryptspec{
        encfun = {crypto_cts, one_time, [aes_256_cbc]},
        macfun = {crypto, macN, [hmac, sha384]},
        maclen = 24, blocklen = 16
    },
    Usage = usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    Triad = base_key_to_triad(aes256_hmac_sha384, Key, Usage),
    IV = <<0:128>>,
    case Opts of
        #{encrypt := true} ->
            encrypt_then_mac(Triad, IV, Data, Spec);
        #{encrypt := false} ->
            de_encrypt_then_mac(Triad, IV, Data, Spec)
    end;
one_time(rc4_hmac, Key, Data, Opts = #{encrypt := true}) ->
    T = ms_usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    K1 = crypto:mac(hmac, md5, Key, <<T:32/little>>),
    K2 = K1,
    Confounder = crypto:strong_rand_bytes(8),
    MAC = crypto:mac(hmac, md5, K2, [Confounder, Data]),
    K3 = crypto:mac(hmac, md5, K1, MAC),
    EncPart = crypto:crypto_one_time(rc4, K3, [Confounder, Data], true),
    iolist_to_binary([MAC, EncPart]);
one_time(rc4_hmac, Key, Data, Opts = #{encrypt := false}) ->
    T = ms_usage_a2i(maps:get(usage, Opts, app_data_cksum)),
    K1 = crypto:mac(hmac, md5, Key, <<T:32/little>>),
    K2 = K1,
    <<MAC:16/binary, EncPart/binary>> = Data,
    K3 = crypto:mac(hmac, md5, K1, MAC),
    PlainPart = crypto:crypto_one_time(rc4, K3, EncPart, false),
    <<Confounder:8/binary, Plain/binary>> = PlainPart,
    OurMAC = crypto:mac(hmac, md5, K2, [Confounder, Plain]),
    if
        (OurMAC =:= MAC) -> ok;
        true -> error({bad_mac, OurMAC, MAC})
    end,
    Plain;
one_time(E, _, _, _) -> error({unknown_etype, E}).

encrypt_and_mac({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize,
               padding = Pad} = Spec,
    Confounder = crypto:strong_rand_bytes(BlockSize),
    PreMAC = pad_block(Pad, <<Confounder/binary, Data/binary>>, BlockSize),
    MAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, PreMAC, MacLength]),
    Enc = erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, PreMAC, true]),
    <<Enc/binary, MAC/binary>>.

encrypt_then_mac({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize,
               padding = Pad} = Spec,
    Confounder = crypto:strong_rand_bytes(BlockSize),
    PreMAC = pad_block(Pad, <<Confounder/binary, Data/binary>>, BlockSize),
    Enc = erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, PreMAC, true]),
    IVEnc = iolist_to_binary([IV, Enc]),
    MAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, IVEnc, MacLength]),
    <<Enc/binary, MAC/binary>>.

mac_then_encrypt({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize,
               padding = Pad} = Spec,
    Confounder = crypto:strong_rand_bytes(BlockSize),
    PreMAC = pad_block(Pad, <<Confounder/binary, 0:MacLength/unit:8, Data/binary>>, BlockSize),
    MAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, PreMAC, MacLength]),
    PostMAC = pad_block(Pad, <<Confounder/binary, MAC/binary, Data/binary>>, BlockSize),
    erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, PostMAC, true]).

de_mac_then_encrypt({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize} = Spec,
    PostMAC = erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, Data, false]),
    <<Confounder:BlockSize/binary, MAC:MacLength/binary, PaddedData/binary>> = PostMAC,
    PreMAC = <<Confounder/binary, 0:MacLength/unit:8, PaddedData/binary>>,
    OurMAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, PreMAC, MacLength]),
    if
        (OurMAC =:= MAC) -> ok;
        true -> error({bad_mac, OurMAC, MAC})
    end,
    PaddedData.

de_encrypt_and_mac({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize} = Spec,
    EncLen = byte_size(Data) - MacLength,
    <<Enc:EncLen/binary, HMAC/binary>> = Data,
    PreMAC = erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, Enc, false]),
    OurHMAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, PreMAC, MacLength]),
    if
        (OurHMAC =:= HMAC) -> ok;
        true -> error({bad_mac, OurHMAC, HMAC})
    end,
    <<_Confounder:BlockSize/binary, Plain/binary>> = PreMAC,
    Plain.

de_encrypt_then_mac({_Kc, Ke, Ki}, IV, Data, Spec = #cryptspec{}) ->
    #cryptspec{encfun = {EncMod, EncFun, EncArgs},
               macfun = {MacMod, MacFun, MacArgs},
               maclen = MacLength,
               blocklen = BlockSize} = Spec,
    EncLen = byte_size(Data) - MacLength,
    <<Enc:EncLen/binary, HMAC/binary>> = Data,
    IVEnc = iolist_to_binary([IV, Enc]),
    OurHMAC = erlang:apply(MacMod, MacFun, MacArgs ++ [Ki, IVEnc, MacLength]),
    if
        (OurHMAC =:= HMAC) -> ok;
        true -> error({bad_mac, OurHMAC, HMAC})
    end,
    PreMAC = erlang:apply(EncMod, EncFun, EncArgs ++ [Ke, IV, Enc, false]),
    <<_Confounder:BlockSize/binary, Plain/binary>> = PreMAC,
    Plain.

-spec base_key_to_triad(base_key(), usage()) -> protocol_key().
base_key_to_triad(#krb_base_key{etype = ET, key = K}, U) ->
    base_key_to_triad(ET, K, usage_a2i(U)).

-spec base_key_to_triad(etype(), binary(), integer()) -> protocol_key().
base_key_to_triad(aes128_hmac_sha256, BaseKey, Usage) ->
    Kc = aes_kdf(sha256, BaseKey, <<Usage:32/big, 16#99>>, 128),
    Ke = aes_kdf(sha256, BaseKey, <<Usage:32/big, 16#AA>>, 128),
    Ki = aes_kdf(sha256, BaseKey, <<Usage:32/big, 16#55>>, 128),
    {Kc, Ke, Ki};
base_key_to_triad(aes256_hmac_sha384, BaseKey, Usage) ->
    Kc = aes_kdf(sha384, BaseKey, <<Usage:32/big, 16#99>>, 192),
    Ke = aes_kdf(sha384, BaseKey, <<Usage:32/big, 16#AA>>, 256),
    Ki = aes_kdf(sha384, BaseKey, <<Usage:32/big, 16#55>>, 192),
    {Kc, Ke, Ki};
base_key_to_triad(EType, BaseKey, Usage) ->
    Cipher = case EType of
        des_crc -> des_cbc;
        des_md4 -> des_cbc;
        des_md5 -> des_cbc;
        des3_md5 -> des_ede3_cbc;
        des3_sha1 -> des_ede3_cbc;
        aes128_hmac_sha1 -> aes_128_cbc;
        aes256_hmac_sha1 -> aes_256_cbc
    end,
    Kc = dk(Cipher, BaseKey, <<Usage:32/big, 16#99>>),
    Ke = dk(Cipher, BaseKey, <<Usage:32/big, 16#aa>>),
    Ki = dk(Cipher, BaseKey, <<Usage:32/big, 16#55>>),
    {Kc, Ke, Ki}.

-spec dr_kn(atom(), binary(), binary(), binary(), integer()) -> [binary()].
dr_kn(_Cipher, _KNPrev, _Key, _IV, 0) -> [];
dr_kn(Cipher, KNPrev, Key, IV, N) ->
    Block = crypto:crypto_one_time(Cipher, Key, IV, KNPrev, true),
    [Block | dr_kn(Cipher, Block, Key, IV, N - 1)].

-spec dr(atom(), binary(), binary()) -> binary().
dr(Cipher, BaseKey, Constant) ->
    case Cipher of
        des_cbc ->
            BlockSizeBytes = 8, KeySizeBytes = 7;
        des_ede3_cbc ->
            BlockSizeBytes = 8, KeySizeBytes = 21;
        _ ->
            #{block_size := BlockSizeBytes, key_length := KeySizeBytes} =
                crypto:cipher_info(Cipher)
    end,
    Blocks = (KeySizeBytes div BlockSizeBytes) + 1,
    DRBlocks = iolist_to_binary(dr_kn(Cipher,
        nfold(BlockSizeBytes * 8, Constant), BaseKey,
        <<0:BlockSizeBytes/unit:8>>, Blocks)),
    <<DR:KeySizeBytes/binary, _/binary>> = DRBlocks,
    DR.

-spec dk(atom(), binary(), binary()) -> binary().
dk(Cipher, BaseKey, Constant) ->
    DR = dr(Cipher, BaseKey, Constant),
    case Cipher of
        des_cbc ->
            des_random_to_key(<<0:64>>, DR);
        des_ede3_cbc ->
            des3_random_to_key(DR);
        _ ->
            #{key_length := KeySize} = crypto:cipher_info(Cipher),
            <<DK:KeySize/binary, _/binary>> = DR,
            DK
    end.

to_56bstr(B) ->
    << <<Low:7>> || <<_:1,Low:7>> <= B >>.

des_add_parity(B) ->
    << <<N:7,(odd_parity(N)):1>> || <<N:7>> <= B >>.
des_fix_parity(B) ->
    << <<N:7,(odd_parity(N)):1>> || <<N:7,_:1>> <= B >>.
odd_parity(N) ->
    Set = length([ 1 || <<1:1>> <= <<N>> ]),
    if (Set rem 2 == 1) -> 0; true -> 1 end.

bitrev(<<>>) -> <<>>;
bitrev(<<N:1>>) -> <<N:1>>;
bitrev(<<N:1, Rest/bitstring>>) ->
    RestRev = bitrev(Rest),
    <<RestRev/bitstring, N:1>>.

-spec binxor(bitstring(), bitstring()) -> bitstring().
binxor(<<>>, <<>>) -> <<>>;
binxor(<<N:64>>, <<M:64>>) -> X = N bxor M, <<X:64>>;
binxor(<<N:56>>, <<M:56>>) -> X = N bxor M, <<X:56>>;
binxor(<<N:8, RestN/bitstring>>, <<M:8, RestM/bitstring>>) ->
    Rest = binxor(RestN, RestM),
    X = N bxor M,
    <<X:8, Rest/bitstring>>;
binxor(<<N:1, RestN/bitstring>>, <<M:1, RestM/bitstring>>) ->
    Rest = binxor(RestN, RestM),
    X = N bxor M,
    <<X:1, Rest/bitstring>>.

des_string_to_key_stage(State, _, <<>>) ->
    State;
des_string_to_key_stage(State, Odd, <<Block:8/binary, Rest/binary>>) ->
    As56 = to_56bstr(Block),
    Xor = if (Odd) -> As56; (not Odd) -> bitrev(As56) end,
    State2 = binxor(State, Xor),
    des_string_to_key_stage(State2, (not Odd), Rest).

ms_string_to_key(Bin) ->
    crypto:hash(md4, unicode:characters_to_binary(Bin, utf8, {utf16, little})).


-spec pad_block(boolean(), binary(), integer()) -> binary().
pad_block(true, B, N) -> pad_block(B, N);
pad_block(false, B, _N) -> B.
-spec pad_block(binary()) -> binary().
pad_block(B) -> pad_block(B, 8).
-spec pad_block(binary(), integer()) -> binary().
pad_block(B, 1) -> B;
pad_block(B, N) ->
    Rem = byte_size(B) rem 8,
    case Rem of
        0 -> B;
        _ -> <<B/binary, 0:(N - Rem)/unit:8>>
    end.

-spec string_to_key(etype(), binary(), binary()) -> base_key().
string_to_key(des_crc, String, Salt) ->
    #krb_base_key{etype = des_crc, key = des_string_to_key(String, Salt)};
string_to_key(des_md4, String, Salt) ->
    #krb_base_key{etype = des_md4, key = des_string_to_key(String, Salt)};
string_to_key(des_md5, String, Salt) ->
    #krb_base_key{etype = des_md5, key = des_string_to_key(String, Salt)};
string_to_key(des3_md5, String, Salt) ->
    #krb_base_key{etype = des3_md5, key = des3_string_to_key(String, Salt)};
string_to_key(des3_sha1, String, Salt) ->
    #krb_base_key{etype = des3_sha1, key = des3_string_to_key(String, Salt)};
string_to_key(aes128_hmac_sha1, String, Salt) ->
    #krb_base_key{etype = aes128_hmac_sha1,
                  key = aes_string_to_key(aes_128_cbc, 16, String, Salt)};
string_to_key(aes256_hmac_sha1, String, Salt) ->
    #krb_base_key{etype = aes256_hmac_sha1,
                  key = aes_string_to_key(aes_256_cbc, 32, String, Salt)};
string_to_key(aes128_hmac_sha256, String, Salt) ->
    SaltP = <<"aes128-cts-hmac-sha256-128", 0, Salt/binary>>,
    #krb_base_key{etype = aes128_hmac_sha256,
                  key = aes2_string_to_key(aes128_hmac_sha256, String, SaltP)};
string_to_key(aes256_hmac_sha384, String, Salt) ->
    SaltP = <<"aes256-cts-hmac-sha384-192", 0, Salt/binary>>,
    #krb_base_key{etype = aes256_hmac_sha384,
                  key = aes2_string_to_key(aes256_hmac_sha384, String, SaltP)};
string_to_key(rc4_hmac, String, _Salt) ->
    #krb_base_key{etype = rc4_hmac, key = ms_string_to_key(String)};
string_to_key(E, _, _) -> error({unknown_etype, E}).

-spec random_to_key(etype()) -> base_key().
random_to_key(ET) ->
	random_to_key(ET, crypto:strong_rand_bytes(32)).
-spec random_to_key(etype(), binary()) -> base_key().
random_to_key(des_crc, Data) ->
    #krb_base_key{etype = des_crc, key = des_random_to_key(Data, Data)};
random_to_key(des_md4, Data) ->
    #krb_base_key{etype = des_md4, key = des_random_to_key(<<0:64>>, Data)};
random_to_key(des_md5, Data) ->
    #krb_base_key{etype = des_md5, key = des_random_to_key(<<0:64>>, Data)};
random_to_key(des3_md5, Data) ->
    #krb_base_key{etype = des3_md5, key = des3_random_to_key(Data)};
random_to_key(des3_sha1, Data) ->
    #krb_base_key{etype = des3_sha1, key = des3_random_to_key(Data)};
random_to_key(aes128_hmac_sha1, Data) ->
    #krb_base_key{etype = aes128_hmac_sha1,
                  key = aes_random_to_key(aes_128_cbc, Data)};
random_to_key(aes256_hmac_sha1, Data) ->
    #krb_base_key{etype = aes256_hmac_sha1,
                  key = aes_random_to_key(aes_256_cbc, Data)};
random_to_key(aes128_hmac_sha256, Data) ->
	<<Key:128/bitstring, _/binary>> = Data,
    #krb_base_key{etype = aes128_hmac_sha256, key = Key};
random_to_key(aes256_hmac_sha384, Data) ->
	<<Key:256/bitstring, _/binary>> = Data,
    #krb_base_key{etype = aes256_hmac_sha384, key = Key};
random_to_key(rc4_hmac, Data) ->
    <<Key:128/bitstring, _/binary>> = Data,
    #krb_base_key{etype = rc4_hmac, key = Key};
random_to_key(E, _) -> error({unknown_etype, E}).

aes_kdf(Hash, Key, Label, K) ->
    K1 = crypto:mac(hmac, Hash, Key, <<1:32/big, Label/binary, 0, K:32/big>>),
    <<D:K/bitstring, _/bitstring>> = K1,
    D.

des_random_to_key(IV, Data) ->
    DRBlocks = iolist_to_binary(dr_kn(des_cbc,
        nfold(64, <<"kerberos">>), Data, IV, 2)),
    <<DR:56/bitstring, _/binary>> = DRBlocks,
    des_add_parity(DR).

des3_string_to_key(String, Salt) ->
    B0 = iolist_to_binary([String, Salt]),
    B1 = nfold(168, B0),
    B2 = des3_random_to_key(B1),
    dk(des_ede3_cbc, B2, <<"kerberos">>).

split_des3_bits(<<>>) -> {<<>>, <<>>};
split_des3_bits(<<A:7, B:1, Rest/bitstring>>) ->
    {Ac0, Bc0} = split_des3_bits(Rest),
    {<<A:7, (odd_parity(A)):1, Ac0/bitstring>>,
     <<Bc0/bitstring, B:1>>}.

des3_random_to_key(<<K0:56/bitstring, K1:56/bitstring, K2:56/bitstring,
                     _/bitstring>>) ->
    {AcP0, Bc0} = split_des3_bits(K0),
    {AcP1, Bc1} = split_des3_bits(K1),
    {AcP2, Bc2} = split_des3_bits(K2),
    <<B0:7>> = Bc0, <<B1:7>> = Bc1, <<B2:7>> = Bc2,
    <<AcP0/bitstring, B0:7, (odd_parity(B0)):1,
      AcP1/bitstring, B1:7, (odd_parity(B1)):1,
      AcP2/bitstring, B2:7, (odd_parity(B2)):1>>.

aes_random_to_key(Cipher, Data) ->
    #{key_length := KeySize} = crypto:cipher_info(Cipher),
    dk(Cipher, binary:part(Data, 0, KeySize), <<"kerberos">>).

des_string_to_key(String, Salt) ->
    Padded = pad_block(<<String/binary, Salt/binary>>),
    RawKey = des_string_to_key_stage(<<0:56>>, true, Padded),
    RawKeyParity = des_add_parity(RawKey),
    Crypt = crypto:crypto_one_time(des_cbc, RawKeyParity, RawKeyParity, Padded, true),
    LastBlock = binary:part(Crypt, {byte_size(Crypt), -8}),
    des_fix_parity(LastBlock).

aes2_string_to_key(EType, String, SaltP) ->
    {Hash, Size} = case EType of
        aes128_hmac_sha256 -> {sha256, 128};
        aes256_hmac_sha384 -> {sha384, 256}
    end,
    {ok, TKey} = pbkdf2:pbkdf2(Hash, String, SaltP, 32768, Size div 8),
    aes_kdf(Hash, TKey, <<"kerberos">>, Size).

aes_string_to_key(Cipher, Size, String, Salt) ->
    {ok, KdfOut} = pbkdf2:pbkdf2(sha, String, Salt, 4096, Size),
    aes_random_to_key(Cipher, KdfOut).

-spec nfold(integer(), bitstring()) -> bitstring().
nfold(N, X) when is_integer(N) and is_binary(X) ->
    RepLen = lcm(N, bit_size(X)),
    Blocks = nfold_rep(<<>>, X, RepLen),
    nfold_sum(<<0:N>>, Blocks, N).

nfold_rep(SoFar, _Block, N) when bit_size(SoFar) >= N -> SoFar;
nfold_rep(SoFar0, Block0, N) ->
    SoFar = <<SoFar0/binary, Block0/binary>>,
    HeadSize = bit_size(Block0) - (13 rem bit_size(Block0)),
    <<Head:HeadSize/bitstring, Tail/bitstring>> = Block0,
    Block = <<Tail/bitstring, Head/bitstring>>,
    nfold_rep(SoFar, Block, N).

nfold_sum(Sum, <<>>, _N) -> Sum;
nfold_sum(Sum0, Blocks, N) ->
    <<X0:N/big>> = Sum0,
    <<X:N/big, Rest/bitstring>> = Blocks,
    Overflow = (X0 + X) div (1 bsl N),
    Sum1 = <<(X0 + X + Overflow):N/big>>,
    nfold_sum(Sum1, Rest, N).

-spec gcd(integer(), integer()) -> integer().
gcd(A, 0) -> A;
gcd(A, B) -> gcd(B, A rem B).
-spec lcm(integer(), integer()) -> integer().
lcm(A, B) -> abs(A*B div gcd(A,B)).

-define(crc_table, {16#00000000, 16#77073096, 16#ee0e612c, 16#990951ba, 16#076dc419, 16#706af48f,
  16#e963a535, 16#9e6495a3, 16#0edb8832, 16#79dcb8a4, 16#e0d5e91e, 16#97d2d988,
  16#09b64c2b, 16#7eb17cbd, 16#e7b82d07, 16#90bf1d91, 16#1db71064, 16#6ab020f2,
  16#f3b97148, 16#84be41de, 16#1adad47d, 16#6ddde4eb, 16#f4d4b551, 16#83d385c7,
  16#136c9856, 16#646ba8c0, 16#fd62f97a, 16#8a65c9ec, 16#14015c4f, 16#63066cd9,
  16#fa0f3d63, 16#8d080df5, 16#3b6e20c8, 16#4c69105e, 16#d56041e4, 16#a2677172,
  16#3c03e4d1, 16#4b04d447, 16#d20d85fd, 16#a50ab56b, 16#35b5a8fa, 16#42b2986c,
  16#dbbbc9d6, 16#acbcf940, 16#32d86ce3, 16#45df5c75, 16#dcd60dcf, 16#abd13d59,
  16#26d930ac, 16#51de003a, 16#c8d75180, 16#bfd06116, 16#21b4f4b5, 16#56b3c423,
  16#cfba9599, 16#b8bda50f, 16#2802b89e, 16#5f058808, 16#c60cd9b2, 16#b10be924,
  16#2f6f7c87, 16#58684c11, 16#c1611dab, 16#b6662d3d, 16#76dc4190, 16#01db7106,
  16#98d220bc, 16#efd5102a, 16#71b18589, 16#06b6b51f, 16#9fbfe4a5, 16#e8b8d433,
  16#7807c9a2, 16#0f00f934, 16#9609a88e, 16#e10e9818, 16#7f6a0dbb, 16#086d3d2d,
  16#91646c97, 16#e6635c01, 16#6b6b51f4, 16#1c6c6162, 16#856530d8, 16#f262004e,
  16#6c0695ed, 16#1b01a57b, 16#8208f4c1, 16#f50fc457, 16#65b0d9c6, 16#12b7e950,
  16#8bbeb8ea, 16#fcb9887c, 16#62dd1ddf, 16#15da2d49, 16#8cd37cf3, 16#fbd44c65,
  16#4db26158, 16#3ab551ce, 16#a3bc0074, 16#d4bb30e2, 16#4adfa541, 16#3dd895d7,
  16#a4d1c46d, 16#d3d6f4fb, 16#4369e96a, 16#346ed9fc, 16#ad678846, 16#da60b8d0,
  16#44042d73, 16#33031de5, 16#aa0a4c5f, 16#dd0d7cc9, 16#5005713c, 16#270241aa,
  16#be0b1010, 16#c90c2086, 16#5768b525, 16#206f85b3, 16#b966d409, 16#ce61e49f,
  16#5edef90e, 16#29d9c998, 16#b0d09822, 16#c7d7a8b4, 16#59b33d17, 16#2eb40d81,
  16#b7bd5c3b, 16#c0ba6cad, 16#edb88320, 16#9abfb3b6, 16#03b6e20c, 16#74b1d29a,
  16#ead54739, 16#9dd277af, 16#04db2615, 16#73dc1683, 16#e3630b12, 16#94643b84,
  16#0d6d6a3e, 16#7a6a5aa8, 16#e40ecf0b, 16#9309ff9d, 16#0a00ae27, 16#7d079eb1,
  16#f00f9344, 16#8708a3d2, 16#1e01f268, 16#6906c2fe, 16#f762575d, 16#806567cb,
  16#196c3671, 16#6e6b06e7, 16#fed41b76, 16#89d32be0, 16#10da7a5a, 16#67dd4acc,
  16#f9b9df6f, 16#8ebeeff9, 16#17b7be43, 16#60b08ed5, 16#d6d6a3e8, 16#a1d1937e,
  16#38d8c2c4, 16#4fdff252, 16#d1bb67f1, 16#a6bc5767, 16#3fb506dd, 16#48b2364b,
  16#d80d2bda, 16#af0a1b4c, 16#36034af6, 16#41047a60, 16#df60efc3, 16#a867df55,
  16#316e8eef, 16#4669be79, 16#cb61b38c, 16#bc66831a, 16#256fd2a0, 16#5268e236,
  16#cc0c7795, 16#bb0b4703, 16#220216b9, 16#5505262f, 16#c5ba3bbe, 16#b2bd0b28,
  16#2bb45a92, 16#5cb36a04, 16#c2d7ffa7, 16#b5d0cf31, 16#2cd99e8b, 16#5bdeae1d,
  16#9b64c2b0, 16#ec63f226, 16#756aa39c, 16#026d930a, 16#9c0906a9, 16#eb0e363f,
  16#72076785, 16#05005713, 16#95bf4a82, 16#e2b87a14, 16#7bb12bae, 16#0cb61b38,
  16#92d28e9b, 16#e5d5be0d, 16#7cdcefb7, 16#0bdbdf21, 16#86d3d2d4, 16#f1d4e242,
  16#68ddb3f8, 16#1fda836e, 16#81be16cd, 16#f6b9265b, 16#6fb077e1, 16#18b74777,
  16#88085ae6, 16#ff0f6a70, 16#66063bca, 16#11010b5c, 16#8f659eff, 16#f862ae69,
  16#616bffd3, 16#166ccf45, 16#a00ae278, 16#d70dd2ee, 16#4e048354, 16#3903b3c2,
  16#a7672661, 16#d06016f7, 16#4969474d, 16#3e6e77db, 16#aed16a4a, 16#d9d65adc,
  16#40df0b66, 16#37d83bf0, 16#a9bcae53, 16#debb9ec5, 16#47b2cf7f, 16#30b5ffe9,
  16#bdbdf21c, 16#cabac28a, 16#53b39330, 16#24b4a3a6, 16#bad03605, 16#cdd70693,
  16#54de5729, 16#23d967bf, 16#b3667a2e, 16#c4614ab8, 16#5d681b02, 16#2a6f2b94,
  16#b40bbe37, 16#c30c8ea1, 16#5a05df1b, 16#2d02ef8d}).

crc_unkey(_Ki, Data, Len) ->
    CRC = crc(Data),
    <<Out:Len/binary, _/binary>> = CRC,
    Out.

hash_unkey(Algo, _Ki, Data, Len) ->
    Hash = crypto:hash(Algo, Data),
    <<Out:Len/binary, _/binary>> = Hash,
    Out.

-spec crc(binary()) -> binary().
crc(B) when is_binary(B) -> << (crc(0, 0, B)):32/little >>.

-spec crc(integer(), binary()) -> integer().
crc(State, B) -> crc(State, 0, B).

-spec crc(integer(), integer(), binary()) -> integer().
crc(State, N, B) when N >= byte_size(B) ->
    State;
crc(State, N, B) ->
    Idx = (State bxor binary:at(B, N)) band 16#ff,
    State2 = element(Idx + 1, ?crc_table) bxor (State bsr 8),
    crc(State2, N+1, B).

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

rfc3961_nfold_1_test() ->
    Input = <<"012345">>,
    Output = base64:decode(<<"vgcmMSdrGVU=">>),
    ?assertMatch(Output, nfold(64, Input)).

rfc3961_nfold_2_test() ->
    Input = <<"password">>,
    Output = base64:decode(<<"eKB7bK+F+g==">>),
    ?assertMatch(Output, nfold(56, Input)).

rfc3961_nfold_3_test() ->
    Input = <<"Rough Consensus, and Running Code">>,
    Output = base64:decode(<<"u27TCHC38OA=">>),
    ?assertMatch(Output, nfold(64, Input)).

rfc3961_nfold_4_test() ->
    Input = <<"password">>,
    Output = base64:decode(<<"WeSoynwDhcPDez9tIAAkfLbmvVs+">>),
    ?assertMatch(Output, nfold(168, Input)).

rfc3961_nfold_5_test() ->
    Input = <<"MASSACHVSETTS INSTITVTE OF TECHNOLOGY">>,
    Output = base64:decode(<<"2zsNjwsGHmAygrMIpQhBIprXmPq5VAwb">>),
    ?assertMatch(Output, nfold(192, Input)).

rfc3961_nfold_6_test() ->
    Input = <<"Q">>,
    Output = base64:decode(<<"UYpUohWoRSpRilSiFahFKlGKVKIV">>),
    ?assertMatch(Output, nfold(168, Input)).

rfc3961_nfold_7_test() ->
    Input = <<"ba">>,
    Output = base64:decode(<<"+yXVMa6JdEmfUv2S6phXxLokzyl+">>),
    ?assertMatch(Output, nfold(168, Input)).

rfc3961_string_to_key_1_test() ->
    Password = <<"password">>,
    Salt = <<"ATHENA.MIT.EDUraeburn">>,
    Key = #krb_base_key{etype = des_crc,
                        key = base64:decode(<<"y8IvriNSmOM=">>)},
    ?assertMatch(Key, string_to_key(des_crc, Password, Salt)).

rfc3961_string_to_key_2_test() ->
    Password = <<"potatoe">>,
    Salt = <<"WHITEHOUSE.GOVdanny">>,
    Key = #krb_base_key{etype = des_crc,
                        key = base64:decode(<<"3z0yp0/ZKgE=">>)},
    ?assertMatch(Key, string_to_key(des_crc, Password, Salt)).

rfc3961_kd_1_test() ->
    BaseKey = base64:decode(<<"3OBrH2TIV6EcPbV8UYmbLMF5EAjOlzuS">>),
    Constant = <<16#0000000155:40/big>>,
    DR = base64:decode(<<"k1B50USQp1wwk8Sm6MOwSccebucF">>),
    DK = base64:decode(<<"klF50EWRp5tdMZLEp+nCibBJxx9u5gTN">>),
    CalcDR = dr(des_ede3_cbc, BaseKey, Constant),
    CalcDK = dk(des_ede3_cbc, BaseKey, Constant),
    io:format("DR = ~999p\n", [DR]),
    ?assertMatch(DR, CalcDR),
    io:format("DK = ~999p\n", [DK]),
    ?assertMatch(DK, CalcDK).

rfc3961_des3_stk_1_test() ->
    Salt = <<"ATHENA.MIT.EDUraeburn">>,
    String = <<"password">>,
    Key = #krb_base_key{etype = des3_md5,
                        key = base64:decode(<<"hQu1E1hUjNBehnaMMT47/vdRGTfc9yw+">>)},
    ?assertMatch(Key, string_to_key(des3_md5, String, Salt)).

rfc3961_des3_stk_2_test() ->
    Salt = <<"WHITEHOUSE.GOVdanny">>,
    String = <<"potatoe">>,
    Key = #krb_base_key{etype = des3_md5,
                        key = base64:decode(<<"380jPdCkMgTqbcQ3+xXgYbApecH3Tzd6">>)},
    ?assertMatch(Key, string_to_key(des3_md5, String, Salt)).

rfc3961_crc_test() ->
    ?assertMatch(<<16#33bc3273:32/big>>, crc(<<"foo">>)),
    ?assertMatch(<<16#d6883eb8:32/big>>, crc(<<"test0123456789">>)),
    ?assertMatch(<<16#f78041e3:32/big>>, crc(<<"MASSACHVSETTS INSTITVTE OF TECHNOLOGY">>)).

rfc8009_kd_1_test() ->
    BaseKey = base64:decode(<<"NwXZYIDBdyig6ADqtuDSPA==">>),
    Kc = base64:decode(<<"sxoBikj1R3b0A+mjljJdww==">>),
    Ke = base64:decode(<<"mxl90ejFYJ1uZ8PjfGLHLg==">>),
    Ki = base64:decode(<<"n9oOVqstheFWmmiGlsJqbA==">>),
    io:format("~9999p\n", [{Kc, Ke, Ki}]),
    ?assertMatch({Kc, Ke, Ki},
        base_key_to_triad(aes128_hmac_sha256, BaseKey, 2)).

rfc8009_kd_2_test() ->
    BaseKey = base64:decode(<<"bUBNN/r3n53w0zVo0yBmmADrSDZHLqigJtFrcYJGDFI=">>),
    Kc = base64:decode(<<"71cYvobMhJY9i7tQMen1xLpB8o+vaec9">>),
    Ke = base64:decode(<<"VqsivuY9gte8Uif2dz+Op6XrHIJRYMODEpgMRC5cfkk=">>),
    Ki = base64:decode(<<"abFlFOPNjla4IBDVxzAStiLE0A/8I+0f">>),
    ?assertMatch({Kc, Ke, Ki},
        base_key_to_triad(aes256_hmac_sha384, BaseKey, 2)).

rfc8009_stk_test() ->
    Passphrase = <<"password">>,
    SaltP = base64:decode(<<"YWVzMTI4LWN0cy1obWFjLXNoYTI1Ni0xMjgAEN+d14PlvIrOoXMOdDVfYUFUSEVOQS5NSVQuRURVcmFlYnVybg==">>),
    Key = <<16#089BCA48B105EA6EA77CA5D2F39DC5E7:128/big>>,
    ?assertMatch(Key, aes2_string_to_key(aes128_hmac_sha256, Passphrase, SaltP)).

rfc8009_stk_2_test() ->
    Passphrase = <<"password">>,
    SaltP = base64:decode(<<"YWVzMjU2LWN0cy1obWFjLXNoYTM4NC0xOTIAEN+d14PlvIrOoXMOdDVfYUFUSEVOQS5NSVQuRURVcmFlYnVybg==">>),
    Key = <<16#45BD806DBF6A833A9CFFC1C94589A222367A79BC21C413718906E9F578A78467:256/big>>,
    ?assertMatch(Key, aes2_string_to_key(aes256_hmac_sha384, Passphrase, SaltP)).

rfc8009_sample_decrypt_5b_test() ->
    Output = base64:decode(<<"hNfzB1TtmHurC/NQa+sJz7VUAs735od86Z4kflLRbtRCHf34l2w=">>),
    BaseKey = #krb_base_key{etype = aes128_hmac_sha256,
                            key = base64:decode(<<"NwXZYIDBdyig6ADqtuDSPA==">>)},
    Input = decrypt(BaseKey, Output, #{usage => kdc_rep_ticket}),
    ?assertMatch(<<0,1,2,3,4,5>>, Input).

rfc8009_sample_decrypt_256_test() ->
    Output = base64:decode(<<"QAE+LfWOh1GVfSh4vNLW/hAcz9VWyx6ueds8PuhkKfKypgKshv727LZH1ilfrgd6H+tRdQjSwWtBkuAfYg==">>),
    Key = #krb_base_key{
        etype = aes256_hmac_sha384,
        key = base64:decode(<<"bUBNN/r3n53w0zVo0yBmmADrSDZHLqigJtFrcYJGDFI=">>)
    },
    Input = base64:decode(<<"AAECAwQFBgcICQoLDA0ODxAREhMU">>),
    ?assertMatch(Input, decrypt(Key, Output, #{usage => kdc_rep_ticket})).

pcap_1_test() ->
    Output = base64:decode(<<"Les525C4ZmMX+IsZRTf0ULeqLMbn6tEOZQdxcSfqH2DKIt4ngmsy55C1zDXhCYEYXlvBKMQKyWVgA8n/">>),
    BaseKey = string_to_key(des3_sha1, <<"root">>, <<"EXAMPLE.COMrootadmin">>),
    Decrypted = decrypt(BaseKey, Output, #{usage => as_req_pa_enc_ts}),
    Actual = base64:decode(<<"MBqgERgPMjAyMTA1MTcwNTIxMjZaoQUCAwSCcgAAAAA=">>),
    ?assertMatch(Actual, Decrypted).

loopback_test() ->
    Input = <<"foobar">>,
    BaseKey = string_to_key(des3_sha1, <<"foo">>, <<"EXAMPLE.COMfoo">>),
    Encrypted = encrypt(BaseKey, Input, #{usage => as_req_pa_enc_ts}),
    Decrypted = decrypt(BaseKey, Encrypted, #{usage => as_req_pa_enc_ts}),
    ?assertMatch(<<Input:(byte_size(Input))/binary, _/binary>>, Decrypted).

loopback_2_test() ->
    Input = <<"foobar">>,
    BaseKey = string_to_key(aes128_hmac_sha256, <<"foo">>, <<"EXAMPLE.COMfoo">>),
    Encrypted = encrypt(BaseKey, Input, #{usage => as_req_pa_enc_ts}),
    Decrypted = decrypt(BaseKey, Encrypted, #{usage => as_req_pa_enc_ts}),
    ?assertMatch(Input, Decrypted).

pcap_2_test() ->
    Output = base64:decode(<<"K40hf8zUDGP+I/8kW6JRW9qve26CFr+86jdfL912V+n3A0eviW49tCYirQFHdP2odOn5uqy+zw==">>),
    BaseKey = string_to_key(aes256_hmac_sha1, <<"root">>, <<"EXAMPLE.COMroot">>),
    Input = base64:decode(<<"MBmgERgPMjAyMTA1MTgwMzU2MDZaoQQCAgMh">>),
    ?assertMatch(Input, decrypt(BaseKey, Output, #{usage => as_req_pa_enc_ts})).

pcap_3_test() ->
    Output = base64:decode(<<"zywlQYED3qgionoqmuNPa3VPJp9a2347o5NDGAyD+Qq14JglvsyJOw==">>),
    BaseKey = string_to_key(des_crc, <<"root">>, <<"EXAMPLE.COMroot">>),
    Input = base64:decode(<<"MBmgERgPMjAyMTA1MTgwNDAwMzVaoQQCAgEqAA==">>),
    ?assertMatch(Input, decrypt(BaseKey, Output, #{usage => as_req_pa_enc_ts})).

pcap_4_test() ->
    Output = base64:decode(<<"VB8utLYRqScFZiSEO/8nwACAcBMCPKLaChTgmOr8hGRoftvqiKI7MxFs/nz74FsjTQmydgr4OsNsfJ9i">>),
    BaseKey = string_to_key(aes128_hmac_sha256, <<"root">>, <<"EXAMPLE.COMroot">>),
    Input = base64:decode(<<"MBqgERgPMjAyMTA1MTgwNDE2NTNaoQUCAwr2Cg==">>),
    ?assertMatch(Input, decrypt(BaseKey, Output, #{usage => as_req_pa_enc_ts})).

-endif.
