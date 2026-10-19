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

-module(krb_realm_conf).

-export([configure/1, configure/2]).
-export_type([kdc_spec/0, config/0, otp_config/0]).

-type kdc_spec() :: inet:ip_address() | inet:hostname() |
    {inet:ip_address() | inet:hostname(), Port :: integer()}.

-type msecs() :: integer().

-type realm() :: string().

-type otp_realm_config() :: [{default | realm(), config_list()}].
-type otp_config() :: {kerlberos, [
        {realms, [otp_realm_config()]}
    ]}.

-type config_list() :: [config_list_item()].
-type config_list_item() :: {realm, realm()} | {kdc, [kdc_spec()]} |
    {use_dns, boolean()} | {port, integer()} | {parallel, integer()} |
    {timeout, msecs()} | {retries, integer()} |
    {ciphers, [krb_crypto:etype()]}.

-type config() :: #{
    realm => realm(),
    kdc => [kdc_spec()],
    use_dns => boolean(),
    port => integer(),
    parallel => integer(),
    timeout => msecs(),
    retries => integer(),
    ciphers => [krb_crypto:etype()]}. %%
%% Describes configuration relating to a specific Kerberos realm and how to
%% communicate with it.
%%
%% Configuration is taken from (in order of priority, highest priority first):
%% <ol>
%%   <li>Parameters given to <code>krb_realm_config:configure/2</code></li>
%%   <li>OTP application configuration for <code>kerlberos</code> (see the
%%       type <code>otp_config()</code></li>
%%   <li>System-wide configuration files (<code>/etc/krb5.conf</code> etc.)</li>
%%   <li>Hard-coded default values</li>
%% </ol>

-spec configure(realm()) -> config().
configure(Realm) ->
    configure(Realm, #{}).

-compile([{parse_transform, lager_transform}]).

-spec configure(realm(), config()) -> config().
configure(Realm, UserConf) ->
    Conf0 = #{
        realm => Realm,
        port => 88,
        use_dns => true,
        timeout => 1000,
        retries => 3,
        parallel => 3,
        ciphers => [aes256_hmac_sha384, aes128_hmac_sha256, aes256_hmac_sha1,
            aes128_hmac_sha1, des3_sha1],
        kdc => [],
        ttl => 3600
    },
    Conf1 = add_realm_conf(Conf0, [
        "/opt/local/etc/krb5/krb5.conf",
        "/opt/local/etc/krb5.conf",
        "/etc/krb5/krb5.conf",
        "/etc/krb5.conf"
    ], unicode:characters_to_binary(Realm, utf8)),
    {GlobalConfig, RealmConfig} = case application:get_env(kerlberos, realms) of
        {ok, KC} ->
            {maps:from_list(proplists:get_value(default, KC, [])),
             maps:from_list(proplists:get_value(Realm, KC, []))};
        _ -> {#{}, #{}}
    end,
    Conf2 = maps:merge(maps:merge(Conf1, GlobalConfig), RealmConfig),
    Conf3 = maps:merge(Conf2, UserConf),
    Conf4 = case Conf3 of
        #{use_dns := true} ->
            lookup_kdcs(Conf3, Realm);
        _ ->
            Conf3
    end,
    #{port := KdcPort, kdc := Kdcs0} = Conf4,
    Kdcs1 = lists:map(fun
        ({Host, Port}) -> {Host, Port};
        (Host) -> {Host, KdcPort}
    end, Kdcs0),
    _Conf5 = Conf4#{kdc => Kdcs1}.

-spec lookup_kdcs(config(), string()) -> config().
lookup_kdcs(C0, Domain) ->
    lookup_kdcs(C0, Domain, false).

-spec lookup_kdcs(config(), string(), boolean()) -> config().
lookup_kdcs(C0, Domain, ForceTCP) ->
    Label = "_kerberos._udp." ++ string:to_lower(Domain),
    ResOpts0 = [{nxdomain_reply, true}, {edns, 0}, {udp_payload_size, 1200}],
    ResOpts1 = if ForceTCP -> [{usevc, true} | ResOpts0]; true -> ResOpts0 end,
    R = inet_res:resolve(Label, in, srv, ResOpts1),
    case R of
        {ok, Msg} ->
            Answers = inet_dns:msg(Msg, anlist),
            Srvs = lists:foldl(fun (RR, Acc) ->
                case {inet_dns:rr(RR, class), inet_dns:rr(RR, type)} of
                    {in, srv} ->
                        TTL = inet_dns:rr(RR, ttl),
                        Data = inet_dns:rr(RR, data),
                        [{TTL, Data} | Acc];
                    _ ->
                        Acc
                end
            end, [], Answers),
            MinTTL0 = lists:min([TTL || {TTL, _Srv} <- Srvs]),
            MinTTL1 = case C0 of
                #{ttl := OtherTTL} when (OtherTTL < MinTTL0) -> OtherTTL;
                _ -> MinTTL0
            end,
            #{kdc := Kdc0} = C0,
            DNSKDCs = [{Name, Port} ||
                {_TTL, {_Prio, _Weight, Port, Name}} <- Srvs],
            C0#{ttl => MinTTL1, kdc => Kdc0 ++ DNSKDCs};
        {error, formerr} when (not ForceTCP) ->
            lookup_kdcs(C0, Domain, true);
        {error, {_Why, Msg}} ->
            NSs = inet_dns:msg(Msg, nslist),
            TTLs0 = lists:foldl(fun (RR, Acc) ->
                case {inet_dns:rr(RR, class), inet_dns:rr(RR, type)} of
                    {in, soa} ->
                        TTL = inet_dns:rr(RR, ttl),
                        [TTL | Acc];
                    _ ->
                        Acc
                end
            end, [], NSs),
            TTLs1 = case C0 of
                #{ttl := TTL} -> [TTL | TTLs0];
                _ -> TTLs0
            end,
            case TTLs1 of
                [] -> C0;
                _ -> C0#{ttl => lists:min(TTLs1)}
            end;
        {error, _} ->
            C0
    end.

-spec add_realm_conf(config(), [string()], binary()) -> config().
add_realm_conf(C0, [], _Realm) -> C0;
add_realm_conf(C0, [Path | Rest], Realm) ->
    case file:read_file(Path) of
        {ok, D} ->
            case (catch krb5conf:parse(D)) of
                {Co, Rem, _Pos} when is_list(Co) and is_binary(Rem) ->
                    LibDefs = proplists:get_value(<<"libdefaults">>, Co, []),
                    Realms = proplists:get_value(<<"realms">>, Co, []),
                    RealmConf = proplists:get_value(Realm, Realms, []),
                    Combined = LibDefs ++ RealmConf,
                    C1 = case proplists:get_value(<<"allow_weak_crypto">>, Combined) of
                        <<"true">> ->
                            #{ciphers := Cph0} = C0,
                            Cph1 = case lists:member(des_crc, Cph0) of
                                true -> Cph0;
                                false -> Cph0 ++ [des3_md5, rc4_hmac,
                                    rc4_hmac_exp, des_md5, des_md4, des_crc]
                            end,
                            C0#{ciphers => Cph1};
                        _ ->
                            #{ciphers := Cph0} = C0,
                            Cph1 = Cph0 -- [des_crc, des_md4, des_md5,
                                des3_sha1_nokd, des3_md5, rc4_hmac,
                                rc4_hmac_exp],
                            C0#{ciphers => Cph1}
                    end,
                    C2 = case proplists:get_all_values(<<"kdc">>, Combined) of
                        [] -> C1;
                        KdcSpecBins ->
                            KdcSpecs = lists:map(fun (KdcSpecBin) ->
                                case binary:split(KdcSpecBin, [<<$:>>]) of
                                    [HostnameBin, PortBin] ->
                                        Hostname = unicode:characters_to_list(
                                            HostnameBin, utf8),
                                        {Hostname, binary_to_integer(PortBin)};
                                    [HostnameBin] ->
                                        #{port := DefaultPort} = C1,
                                        Hostname = unicode:characters_to_list(
                                            HostnameBin, utf8),
                                        {Hostname, DefaultPort}
                                end
                            end, KdcSpecBins),
                            #{kdc := Kdc0} = C1,
                            Kdc1 = Kdc0 ++ KdcSpecs,
                            C1#{kdc => Kdc1}
                    end,
                    C3 = case proplists:get_value(<<"dns_lookup_kdc">>, Combined) of
                        <<"false">> ->
                            C2#{use_dns => false};
                        _ ->
                            C2#{use_dns => true}
                    end,
                    add_realm_conf(C3, Rest, Realm);
                _ ->
                    add_realm_conf(C0, Rest, Realm)
            end;
        _ ->
            add_realm_conf(C0, Rest, Realm)
    end.
