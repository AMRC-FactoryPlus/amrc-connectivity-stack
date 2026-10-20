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

%% @doc CBC-CTS (ciphertext stealing) mode crypto support
-module(crypto_cts).

-export([encrypt/4, decrypt/4, one_time/5]).

-type cipher() :: aes_128_cbc | aes_256_cbc | des_ede3_cbc | des_cbc.

-spec one_time(cipher(), binary(), binary(), binary(), boolean()) -> binary().
one_time(Type, Key, IV, Plain, true) ->
    encrypt(Type, Key, IV, Plain);
one_time(Type, Key, IV, Plain, false) ->
    decrypt(Type, Key, IV, Plain).

-spec encrypt(cipher(), binary(), binary(), binary()) -> binary().
encrypt(Type, Key, IV0, Plain) ->
    #{block_size := BlockSize} = crypto:cipher_info(Type),
    WholeBlocks = byte_size(Plain) div BlockSize,
    Remainder = byte_size(Plain) rem BlockSize,
    Ln = if (Remainder > 0) -> Remainder; true -> BlockSize end,
    Blocks = if (Remainder > 0) -> WholeBlocks + 1; true -> WholeBlocks end,
    {CBCPart, Cn_2} = case Blocks of
        B when B > 2 ->
            Initial = crypto:crypto_one_time(Type, Key, IV0,
                binary:part(Plain, {0, (Blocks - 2)*BlockSize}), true),
            {Initial, binary:part(Initial, {byte_size(Initial), -1 * BlockSize})};
        _ ->
            {<<>>, IV0}
    end,
    Padded = <<Plain/binary, 0:(BlockSize - Ln)/unit:8>>,
    Pn_1 = binary:part(Padded, {(Blocks - 2)*BlockSize, BlockSize}),
    Xn_1 = crypto:exor(Cn_2, Pn_1),
    En_1 = crypto:crypto_one_time(Type, Key, <<0:BlockSize/unit:8>>, Xn_1, true),
    Cn = binary:part(En_1, {0, Ln}),
    P = binary:part(Padded, {(Blocks - 1)*BlockSize, BlockSize}),
    Dn = crypto:exor(En_1, P),
    Cn_1 = crypto:crypto_one_time(Type, Key, <<0:BlockSize/unit:8>>, Dn, true),
    <<CBCPart/binary, Cn_1/binary, Cn/binary>>.

-spec decrypt(cipher(), binary(), binary(), binary()) -> binary().
decrypt(Type, Key, IV0, Cipher) ->
    #{block_size := BlockSize} = crypto:cipher_info(Type),
    WholeBlocks = byte_size(Cipher) div BlockSize,
    Remainder = byte_size(Cipher) rem BlockSize,
    Ln = if (Remainder > 0) -> Remainder; true -> BlockSize end,
    Blocks = if (Remainder > 0) -> WholeBlocks + 1; true -> WholeBlocks end,
    {CBCPart, Cn_2} = if
        (Blocks > 2) ->
            Initial = crypto:crypto_one_time(Type, Key, IV0,
                binary:part(Cipher, {0, (Blocks - 2)*BlockSize}), false),
            {Initial, binary:part(Cipher, {(Blocks - 3)*BlockSize, BlockSize})};
        true ->
            {<<>>, IV0}
    end,
    Cn_1 = if
        (Blocks > 1) ->
            binary:part(Cipher, {(Blocks - 2)*BlockSize, BlockSize});
        true ->
            IV0
    end,
    Cn = binary:part(Cipher, {(Blocks - 1)*BlockSize, Ln}),
    Dn = crypto:crypto_one_time(Type, Key, <<0:BlockSize/unit:8>>, Cn_1, false),
    C = <<Cn/binary, 0:(BlockSize - Ln)/unit:8>>,
    Xn = crypto:exor(Dn, C),
    <<Pn:Ln/binary, XnTail/binary>> = Xn,
    En_1 = <<Cn/binary, XnTail/binary>>,
    Xn_1 = crypto:crypto_one_time(Type, Key, <<0:BlockSize/unit:8>>, En_1, false),
    Pn_1 = crypto:exor(Xn_1, Cn_2),
    <<CBCPart/binary, Pn_1/binary, Pn/binary>>.

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

rfc_3962_1_test() ->
    Key = base64:decode(<<"Y2hpY2tlbiB0ZXJpeWFraQ==">>),
    IV = <<0:128>>,
    Input = base64:decode(<<"SSB3b3VsZCBsaWtlIHRoZSA=">>),
    Output = base64:decode(<<"xjU1aPK/jLTYpYA2Laf/f5c=">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).

rfc_3962_2_test() ->
    Key = base64:decode(<<"Y2hpY2tlbiB0ZXJpeWFraQ==">>),
    IV = <<0:128>>,
    Input = base64:decode(<<"SSB3b3VsZCBsaWtlIHRoZSBHZW5lcmFsIEdhdSdzIA==">>),
    Output = base64:decode(<<"/AB4Pg79ssHURdTI7/ftIpdocmjW7MzAwHsl4l7P5Q==">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).

rfc_3962_3_test() ->
    Key = base64:decode(<<"Y2hpY2tlbiB0ZXJpeWFraQ==">>),
    IV = <<0:128>>,
    Input = base64:decode(<<"SSB3b3VsZCBsaWtlIHRoZSBHZW5lcmFsIEdhdSdzIENoaWNrZW4sIHBsZWFzZSwg">>),
    Output = base64:decode(<<"l2hyaNbszMDAeyXiXs/lhJ2ti7uWxM3AO8ED4aGUu9g5MSUjp4Zi1b5/y8yY6/Wo">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).

rfc_8009_1_test() ->
    Key = <<16#9B197DD1E8C5609D6E67C3E37C62C72E:128/big>>,
    IV = <<0:128>>,
    Input = base64:decode(<<"e8ooXi/UEw+1Wxpcg7xbJAABAgMEBQ==">>),
    Output = base64:decode(<<"hNfzB1TtmHurC/NQa+sJz7VUAs735g==">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).

rfc_8009_2_test() ->
    Key = <<16#9B197DD1E8C5609D6E67C3E37C62C72E:128/big>>,
    IV = <<0:128>>,
    Input = base64:decode(<<"VqshcT/2LAoUVyAPb6mUjwABAgMEBQYHCAkKCwwNDg8=">>),
    Output = base64:decode(<<"NRfWQPUN3IrTYocis1adKuB0k/qCYyVAgOplwQCOj8I=">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).

rfc_8009_3_test() ->
    Key = <<16#9B197DD1E8C5609D6E67C3E37C62C72E:128/big>>,
    IV = <<0:128>>,
    Input = base64:decode(<<"p6TimkcozhBmT7ZOSa0/rAABAgMEBQYHCAkKCwwNDg8QERITFA==">>),
    Output = base64:decode(<<"cg9zsY2YWc1sy0NGEVzTNscPWO3AxEN8VXNUTDHIE7zh5tBywQ==">>),
    ?assertMatch(Output, encrypt(aes_128_cbc, Key, IV, Input)),
    ?assertMatch(Input, decrypt(aes_128_cbc, Key, IV, Output)).
-endif.
