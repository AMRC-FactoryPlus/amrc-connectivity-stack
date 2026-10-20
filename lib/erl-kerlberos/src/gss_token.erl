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
-module(gss_token).

-export([decode_initial/1,
         encode_initial/2]).

% see rfc2743

decode_initial(<<16#60, Rem0/binary>>) ->
    {TokenBody, Rest} = asn1_decode_length(Rem0),
    {ok, MechType, MechData} = 'SPNEGO':decode('MechType', TokenBody),
    {MechType, MechData, Rest}.

encode_initial(MechType, MechData) ->
    {ok, MechTypeEnc} = 'SPNEGO':encode('MechType', MechType),
    TokenBody = <<MechTypeEnc/binary, MechData/binary>>,
    <<16#60, (asn1_encode_length(TokenBody))/binary>>.

    %case MechType of
    %  {1, 2, 840, 113554, 1, 2, 2} ->
    %    {1, 3, 6, 1, 5, 5, 2} ->

asn1_encode_length(Data) when byte_size(Data) =< 127 ->
    <<(byte_size(Data)), Data/binary>>;
asn1_encode_length(Data) ->
    Bytes = binary:encode_unsigned(byte_size(Data)),
    <<1:1, (byte_size(Bytes)):7, Bytes/binary, Data/binary>>.

asn1_decode_length(<<0:1, Len:7, Data:Len/binary, Rest/binary>>) ->
    {Data, Rest};
asn1_decode_length(<<1:1, LenBytes:7, Len:LenBytes/big-unit:8,
                     Data:Len/binary, Rest/binary>>) ->
    {Data, Rest}.
