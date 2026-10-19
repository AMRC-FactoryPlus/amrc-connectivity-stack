%% kerlberos
%%
%% Copyright 2020 Alex Wilson <alex@uq.edu.au>
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

%% @doc Functions for decoding Microsoft PACs inside a Kerberos ticket.
-module(krb_ms_pac).

-compile({parse_transform, msrpce_parse_transform}).

-export([decode/1, decode_ticket/1]).

%% @headerfile "ms_pac.hrl"
-include("ms_pac.hrl").
-include("KRB5.hrl").

%% @doc Extracts and decodes a PAC from a given Kerberos ticket.
-spec decode_ticket(#'Ticket'{}) ->
    {ok, #pac{}} | {error, no_pac} | {error, {bad_pac, term()}}.
decode_ticket(#'Ticket'{'enc-part' = ETP = #'EncTicketPart'{}}) ->
    #'EncTicketPart'{'authorization-data' = ADs} = ETP,
    find_pac_ad(ADs).

find_pac_ad(asn1_NOVALUE) ->
    {error, no_pac};
find_pac_ad([]) ->
    {error, no_pac};
find_pac_ad([#'AuthorizationData_SEQOF'{'ad-type' = 128} = AD0 | _]) ->
    #'AuthorizationData_SEQOF'{'ad-data' = D0} = AD0,
    case (catch decode(D0)) of
        {'EXIT', Why} ->
            {error, {bad_pac, Why}};
        Pac = #pac{} ->
            {ok, Pac}
    end;
find_pac_ad([#'AuthorizationData_SEQOF'{'ad-type' = 1} = AD0 | Rest]) ->
    #'AuthorizationData_SEQOF'{'ad-data' = D0} = AD0,
    case krb_proto:decode(D0, ['AuthorizationData']) of
        {ok, InnerAD} ->
            find_pac_ad(Rest ++ InnerAD);
        Err ->
            Err
    end;
find_pac_ad([_ | Rest]) ->
    find_pac_ad(Rest).

%% @doc Decodes a PAC from raw bytes. Throws errors on invalid input.
-spec decode(binary()) -> #pac{}.
decode(Bin = <<Count:32/little, Version:32/little, Rem/binary>>) ->
    Bufs = decode_info_bufs(Count, Rem, Bin),
    #pac{version = Version, buffers = Bufs}.

decode_info_bufs(0, _, _Bin) -> [];
decode_info_bufs(N, <<Type:32/little, Size:32/little, Offset:64/little, Rem/binary>>, Bin) ->
    <<_:Offset/binary, Segment:Size/binary, _/binary>> = Bin,
    Rec = case Type of
        16#01 -> decode_logon_info(Segment, Bin);
        16#0a -> decode_client_info(Segment, Bin);
        16#0c -> decode_upn_dns(Segment, Bin);
        16#0e -> decode_device_info(Segment, Bin);
        % 16#0d -> decode_client_claims(Segment, Bin);
        % 16#0f -> decode_device_claims(Segment, Bin);
        _ -> #pac_unknown{type = Type, data = Segment}
    end,
    [Rec | decode_info_bufs(N - 1, Rem, Bin)].

decode_client_info(Segment, _Bin) ->
    <<TgtTime:64/little, NameLen:16/little, Name:NameLen/binary>> = Segment,
    #pac_client_info{
        tgt_time = TgtTime,
        name = unicode:characters_to_binary(Name, {utf16, little}, utf8)
    }.

decode_upn_dns(Segment, _Bin) ->
    <<UpnLen:16/little, UpnOffset:16/little, DnsNameLen:16/little,
      DnsNameOffset:16/little, _Flags:32/little, _/binary>> =Segment,
    <<_:UpnOffset/binary, Upn:UpnLen/binary, _/binary>> = Segment,
    <<_:DnsNameOffset/binary, DnsName:DnsNameLen/binary, _/binary>> = Segment,
    #pac_upn_dns{
        upn = unicode:characters_to_binary(Upn, {utf16, little}, utf8),
        dns_name = unicode:characters_to_binary(DnsName, {utf16, little}, utf8)
    }.

-rpce(#{endian => little, pointer_aliasing => false}).
-rpce_stream({pac_logon_info, [kerb_pac_info_buffer]}).
-rpce_stream({pac_device_info, [kerb_pac_device_buffer]}).

decode_logon_info(Segment, _Bin) ->
    [#kerb_pac_info_buffer{info = Info}] = decode_pac_logon_info(Segment),
    #pac_logon_info{info = Info}.

decode_device_info(Segment, _Bin) ->
    [#kerb_pac_device_buffer{info = Info}] = decode_pac_device_info(Segment),
    #pac_device_info{info = Info}.


-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

example_pac_test() ->
    WholePac = base64:decode(<<"
MIIFUjCCBU6gBAICAIChggVEBIIFQAQAAAAAAAAAAQAAALAEAABIAAAAAAAAAAoAAAASAAAA+AQA
AAAAAAAGAAAAFAAAABAFAAAAAAAABwAAABQAAAAoBQAAAAAAAAEQCADMzMzMoAQAAAAAAAAAAAIA
0YZmD2VqxgH/////////f/////////9/F9Q5/nhKxgEXlKMoQkvGARdUJJd6gcYBCAAIAAQAAgAk
ACQACAACABIAEgAMAAIAAAAAABAAAgAAAAAAFAACAAAAAAAYAAIAVBAAAJd5LAABAgAAGgAAABwA
AgAgAAAAAAAAAAAAAAAAAAAAAAAAABYAGAAgAAIACgAMACQAAgAoAAIAAAAAAAAAAAAQAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA0AAAAsAAIAAAAAAAAAAAAAAAAABAAAAAAAAAAEAAAA
bAB6AGgAdQASAAAAAAAAABIAAABMAGkAcQBpAGEAbgBnACgATABhAHIAcgB5ACkAIABaAGgAdQAJ
AAAAAAAAAAkAAABuAHQAZABzADIALgBiAGEAdAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAABoAAABhxDMABwAAAAnDLQAHAAAAXrQyAAcAAAABAgAABwAAAJe5LAAHAAAAK/Ey
AAcAAADOMDMABwAAAKcuLgAHAAAAKvEyAAcAAACYuSwABwAAAGLEMwAHAAAAlAEzAAcAAAB2xDMA
BwAAAK7+LQAHAAAAMtIsAAcAAAAWCDIABwAAAEJbLgAHAAAAX7QyAAcAAADKnDUABwAAAIVELQAH
AAAAwvAyAAcAAADp6jEABwAAAO2OLgAHAAAAtusxAAcAAACrLi4ABwAAAHIOLgAHAAAADAAAAAAA
AAALAAAATgBUAEQARQBWAC0ARABDAC0AMAA1AAAABgAAAAAAAAAFAAAATgBUAEQARQBWAAAABAAA
AAEEAAAAAAAFFQAAAFlRuBdmcl0lZGM7Cw0AAAAwAAIABwAAADQAAgAHAAAgOAACAAcAACA8AAIA
BwAAIEAAAgAHAAAgRAACAAcAACBIAAIABwAAIEwAAgAHAAAgUAACAAcAACBUAAIABwAAIFgAAgAH
AAAgXAACAAcAACBgAAIABwAAIAUAAAABBQAAAAAABRUAAAC5MBsut0FMbIw7NRUBAgAABQAAAAEF
AAAAAAAFFQAAAFlRuBdmcl0lZGM7C3RULwAFAAAAAQUAAAAAAAUVAAAAWVG4F2ZyXSVkYzsL6Dgy
AAUAAAABBQAAAAAABRUAAABZUbgXZnJdJWRjOwvNODIABQAAAAEFAAAAAAAFFQAAAFlRuBdmcl0l
ZGM7C120MgAFAAAAAQUAAAAAAAUVAAAAWVG4F2ZyXSVkYzsLQRY1AAUAAAABBQAAAAAABRUAAABZ
UbgXZnJdJWRjOwvo6jEABQAAAAEFAAAAAAAFFQAAAFlRuBdmcl0lZGM7C8EZMgAFAAAAAQUAAAAA
AAUVAAAAWVG4F2ZyXSVkYzsLKfEyAAUAAAABBQAAAAAABRUAAABZUbgXZnJdJWRjOwsPXy4ABQAA
AAEFAAAAAAAFFQAAAFlRuBdmcl0lZGM7Cy9bLgAFAAAAAQUAAAAAAAUVAAAAWVG4F2ZyXSVkYzsL
748xAAUAAAABBQAAAAAABRUAAABZUbgXZnJdJWRjOwsHXy4AAAAAAABJ2Q5lasYBCABsAHoAaAB1
AAAAAAAAAHb///9B7c6aNIFdOu97yYh0gF0lAAAAAHb////3pTTassAphu/g++URCk8yAAAAAA==">>),
    Pac = decode(binary:part(WholePac, 22, byte_size(WholePac) - 22)),
    ?assertMatch(#pac{}, Pac),
    #pac{buffers = Bufs} = Pac,
    #pac_logon_info{info = LogonInfo} = lists:keyfind(pac_logon_info, 1, Bufs),
    ?assertMatch(#kerb_validation_info{
        effective_name = "lzhu",
        user_id = 2914711,
        user_account_control = #{normal := true}
        }, LogonInfo),
    #kerb_validation_info{group_ids = Groups} = LogonInfo,
    [Group0 | _] = Groups,
    ?assertMatch(#group_membership{relative_id = 3392609}, Group0).


-endif.
