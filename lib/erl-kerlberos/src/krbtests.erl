-module(krbtests).

-export([client/0, server/0]).

-include("SPNEGO.hrl").

server() ->
    {ok, KeyTab} = krb_mit_keytab:file("keytab"),
    Princs = lists:usort([P || #{principal := P} <- KeyTab]),
    io:format("keytab has keys for ~p\n", [Princs]),
    Etypes = lists:usort([krb_crypto:key_etype(K) || #{key := K} <- KeyTab]),
    io:format("etypes = ~p\n", [Etypes]),
    {ok, LSock} = gen_tcp:listen(8082,
        [binary, {active, true}, {packet, line}, {reuseaddr, true},
         {packet_size, 16384}, {buffer, 16384}]),
    server(LSock, KeyTab).

server(LSock, KeyTab) ->
    {ok, Sock} = gen_tcp:accept(LSock),
    receive
        {tcp, Sock, Data} ->
            io:format("<= ~s\n", [Data]),
            Ret = gss_spnego:accept(
                base64:decode(Data),
                #{
                    keytab => KeyTab,
                    chan_bindings => <<0:128/big>>,
                    mutual_auth => true
                }),
            case Ret of
                {ok, T0, S0} ->
                    io:format("=> ~s\n", [base64:encode(T0)]),
                    {ok, Peer} = gss_spnego:peer_name(S0),
                    {ok, PeerName} = gss_spnego:translate_name(Peer, ?'id-krb5-name'),
                    io:format("peer: ~s\n", [PeerName]),
                    gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                    server_loop(Sock, S0);
                {continue, T0, S0} ->
                    io:format("=> ~s\n", [base64:encode(T0)]),
                    gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                    server_continue(Sock, S0)
            end;
        {tcp_closed, Sock} ->
            ok
    end,
    server(LSock, KeyTab).

server_continue(Sock, S0) ->
    receive
        {tcp, Sock, Data} ->
            io:format("<= ~s\n", [Data]),
            Ret = gss_spnego:continue(base64:decode(Data), S0),
            case Ret of
                {ok, S1} ->
                    {ok, Peer} = gss_spnego:peer_name(S1),
                    {ok, PeerName} = gss_spnego:translate_name(Peer, ?'id-krb5-name'),
                    io:format("peer: ~s\n", [PeerName]),
                    server_loop(Sock, S1);
                {ok, T0, S1} ->
                    io:format("=> ~s\n", [base64:encode(T0)]),
                    {ok, Peer} = gss_spnego:peer_name(S1),
                    {ok, PeerName} = gss_spnego:translate_name(Peer, ?'id-krb5-name'),
                    io:format("peer: ~s\n", [PeerName]),
                    gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                    server_loop(Sock, S1);
                {continue, T0, S1} ->
                    io:format("=> ~s\n", [base64:encode(T0)]),
                    gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                    server_continue(Sock, S1)
            end;
        {tcp_closed, Sock} ->
            ok
    end.

server_loop(Sock, S0) ->
    receive
        {tcp_closed, Sock} -> ok;
        {tcp, Sock, <<"wrap||", Data/binary>>} ->
            {ok, Msg, S1} = gss_spnego:unwrap(base64:decode(Data), S0),
            io:format("<= ~p\n", [Msg]),
            {ok, T, S2} = gss_spnego:wrap(<<"ok\n">>, S1),
            gen_tcp:send(Sock, ["wrap||", base64:encode(T), $\n]),
            case Msg of
                <<"exit">> ->
                    gen_tcp:close(Sock),
                    ok;
                _ -> server_loop(Sock, S2)
            end;
        {tcp, Sock, <<"mic|", Data/binary>>} ->
            [MsgB64, TokData] = binary:split(Data, [<<$|>>]),
            Msg = base64:decode(MsgB64),
            {ok, S1} = gss_spnego:verify_mic(Msg, base64:decode(TokData), S0),
            io:format("<= ~p\n", [Msg]),
            OutMsg = <<"ok\n">>,
            {ok, T, S2} = gss_spnego:get_mic(OutMsg, S1),
            gen_tcp:send(Sock, ["mic|", base64:encode(OutMsg), $|,
                base64:encode(T), $\n]),
            case Msg of
                <<"exit">> ->
                    gen_tcp:close(Sock),
                    ok;
                _ -> server_loop(Sock, S2)
            end
    end.

client() ->
    {ok, R} = krb_realm:open("EXAMPLE.COM"),

    {ok, TGT} = krb_realm:authenticate(R, ["root"], "root", #{
        etypes => [rc4_hmac]}),
    {ok, SvcTicket} = krb_realm:obtain_ticket(R, TGT,
        ["host", "kdc.example.com"], #{etypes => [rc4_hmac]}),

    {continue, T0, S0} = gss_spnego:initiate(#{
        ticket => SvcTicket,
        chan_bindings => <<0:128/big>>,
        mutual_auth => true
        }),

    {ok, Sock} = gen_tcp:connect("kdc.example.com", 8082,
        [binary, {active, true}, {packet, line}, {packet_size, 16384},
         {buffer, 16384}]),
    gen_tcp:send(Sock, [base64:encode(T0), $\n]),
    client_continue(Sock, S0).

client_loop(Sock, S0) ->
    io:format("in client_loop\n"),
    {ok, T1, S1} = gss_spnego:wrap(<<"hello world\n">>, S0),
    gen_tcp:send(Sock, ["wrap||", base64:encode(T1), $\n]),
    receive
        {tcp, Sock, <<"wrap||", Data1/binary>>} ->
            {ok, Msg0, S2} = gss_spnego:unwrap(base64:decode(Data1), S1),
            io:format("<= ~p\n", [Msg0]),
            Q = <<"what is your name\n">>,
            {ok, T2, S3} = gss_spnego:get_mic(Q, S2),
            gen_tcp:send(Sock, ["mic|", base64:encode(Q), $|,
                base64:encode(T2), $\n]),
            receive
                {tcp, Sock, <<"mic|", Data2Rem/binary>>} ->
                    [Msg1B64, Data2] = binary:split(Data2Rem, [<<$|>>]),
                    Msg1 = base64:decode(Msg1B64),
                    {ok, S4} = gss_spnego:verify_mic(Msg1, base64:decode(Data2), S3),
                    io:format("<= ~p\n", [Msg1]),
                    {ok, T3, S5} = gss_spnego:get_mic(<<"exit">>, S4),
                    gen_tcp:send(Sock, ["mic|", base64:encode(<<"exit">>),
                        $|, base64:encode(T3), $\n])
            end
    end,
    receive
        {tcp_closed, Sock} ->
            ok
    end.

client_continue(Sock, S0) ->
    io:format("client_continue\n"),
    receive
        {tcp, Sock, Data0} ->
            case gss_spnego:continue(base64:decode(Data0), S0) of
                {ok, S1} ->
                    client_loop(Sock, S1);
                {ok, Token, S1} ->
                    gen_tcp:send(Sock, [base64:encode(Token), $\n]),
                    client_loop(Sock, S1);
                {continue, Token, S1} ->
                    gen_tcp:send(Sock, [base64:encode(Token), $\n]),
                    client_continue(Sock, S1)
            end
    end.
