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
-module(gss_bindings).

-export([
    encode_rfc2744/1,
    decode_rfc2744/1,
    encode/1
    ]).

-type gss_af() :: unspec | local | inet | x25 | inet6 | null.

-spec gss_af_i2a(integer()) -> gss_af().
gss_af_i2a(0) -> unspec;
gss_af_i2a(1) -> local;
gss_af_i2a(2) -> inet;
gss_af_i2a(21) -> x25;
gss_af_i2a(24) -> inet6;
gss_af_i2a(255) -> null;
gss_af_i2a(Other) -> error({bad_address_family, Other}).

-spec gss_af_a2i(gss_af()) -> integer().
gss_af_a2i(unspec) -> 0;
gss_af_a2i(local) -> 1;
gss_af_a2i(inet) -> 2;
gss_af_a2i(x25) -> 21;
gss_af_a2i(inet6) -> 24;
gss_af_a2i(null) -> 255;
gss_af_a2i(Other) -> error({bad_address_family, Other}).

-type gss_address() ::
    {inet, inet:ip_address()} |
    {inet6, inet:ip_address()} |
    {local, string()} |
    {unspec, binary()} |
    {x25, binary()} |
    null.

-spec decode_gss_addr(gss_af(), binary()) -> gss_address().
decode_gss_addr(unspec, Data) ->
    {unspec, Data};
decode_gss_addr(local, Data) ->
    {local, unicode:characters_to_list(Data, utf8)};
decode_gss_addr(x25, Data) ->
    {x25, Data};
decode_gss_addr(inet, <<A, B, C, D>>) ->
    {inet, {A, B, C, D}};
decode_gss_addr(inet6, <<A:16/big, B:16/big, C:16/big, D:16/big,
                         E:16/big, F:16/big, G:16/big, H:16/big>>) ->
    {inet6, {A, B, C, D, E, F, G, H}}.

-spec encode_gss_addr(gss_address()) -> binary().
encode_gss_addr({unspec, Data}) ->
    Data;
encode_gss_addr({local, String}) ->
    unicode:characters_to_binary(String, utf8);
encode_gss_addr({x25, Data}) ->
    Data;
encode_gss_addr({inet, {A, B, C, D}}) ->
    <<A, B, C, D>>;
encode_gss_addr({inet, {A, B, C, D, E, F, G, H}}) ->
    <<A:16/big, B:16/big, C:16/big, D:16/big,
      E:16/big, F:16/big, G:16/big, H:16/big>>.

-type rfc2744() :: {rfc2744,
                    Initiator :: gss_address(),
                    Acceptor :: gss_address(),
                    AppData :: binary()}.

-spec encode_rfc2744(rfc2744()) -> binary().
encode_rfc2744({rfc2744,
                Initiator = {InitiatorAF, _},
                Acceptor = {AcceptorAF, _},
                AppData}) ->
    InitiatorData = encode_gss_addr(Initiator),
    AcceptorData = encode_gss_addr(Acceptor),
    <<(gss_af_a2i(InitiatorAF)):32/little,
      (byte_size(InitiatorData)):32/little,
      InitiatorData/binary,
      (gss_af_a2i(AcceptorAF)):32/little,
      (byte_size(AcceptorData)):32/little,
      AcceptorData/binary,
      (byte_size(AppData)):32/little,
      AppData/binary>>.

-spec decode_rfc2744(binary()) -> rfc2744().
decode_rfc2744(<<InitiatorAF:32/little, InitiatorLen:32/little,
                 InitiatorData:(InitiatorLen)/binary,
                 AcceptorAF:32/little, AcceptorLen:32/little,
                 AcceptorData:(AcceptorLen)/binary,
                 AppDataLen:32/little, AppData:(AppDataLen)/binary>>) ->
    Initiator = decode_gss_addr(gss_af_i2a(InitiatorAF), InitiatorData),
    Acceptor = decode_gss_addr(gss_af_i2a(AcceptorAF), AcceptorData),
    {rfc2744, Initiator, Acceptor, AppData}.

encode(B = {rfc2744, _I, _A, _AppData}) ->
    encode_rfc2744(B);
encode(B) when is_binary(B) ->
    B;
encode(Other) -> error({unsupported_binding, Other}).
