kerlberos
=========

Native Erlang library for KerberosV and GSS-API (no NIFs or dependencies on
MIT Kerberos etc).

Features:
 * KerberosV client
   * Authenticate to KDC, obtain a TGT (AS-REQ/AS-REP)
   * Use a TGT to obtain another ticket (TGS-REQ/TGS-REP)
   * Parses `/etc/krb5.conf`, can use DNS discovery for KDCs, supports
     fail-over on KDC unavailability, respects DNS TTLs
 * KerberosV service provider
   * Decode MIT-format keytab file, match against a ticket from a client
   * Unpack and parse AD PAC in service ticket
 * GSS-API initiator/acceptor
   * Support for GSS-KerberosV, including mutual auth, MICs and wrap tokens.
   * Works with all AES and 3DES enctypes (including new SHA2 variants).
     Partial support for RC4 enctypes.
   * Support for SPNEGO negotiating KerberosV.

Compatible with MIT Kerberos and Active Directory (mostly compatible with
Heimdal as well).


Examples
--------

Obtaining a TGT:

    1> {ok, R} = krb_realm:open("EXAMPLE.COM").
    {ok,<0.492.0>}

    2> {ok, TGT} = krb_realm:authenticate(R, ["root"], <<"password">>).
    {ok,#{authtime => <<"20210621065701Z">>,
          endtime => <<"20210621105701Z">>,
          flags => [renewable,proxiable,forwardable,pre_auth,initial],
          key =>
              {krb_base_key,aes256_hmac_sha384,
                            <<66,183,155,201,218,5,35,117,120,222,203,33,247,255,17,
                              96,147,47,59,207,73,152,199,...>>},
          principal => ["root"],
          realm => "EXAMPLE.COM",renewuntil => <<"20210628065701Z">>,
          svc_principal => ["krbtgt","EXAMPLE.COM"],
          ticket =>
              {'Ticket',5,"EXAMPLE.COM",
                        {'PrincipalName',2,["krbtgt","EXAMPLE.COM"]},
                        {'EncryptedData',aes256_hmac_sha384,1,
                                         <<169,171,187,255,155,17,230,248,77,55,190,65,22,151,
                                           170,115,165,...>>}}}}

Using that TGT to obtain a service ticket:

    3> {ok, T} = krb_realm:obtain_ticket(R, TGT, ["host", "kdc.example.com"]).
    {ok,#{authtime => <<"20210621065938Z">>,
          endtime => <<"20210621105937Z">>,
          flags =>
              [transited,renewable,proxiable,forwardable,pre_auth],
          key =>
              {krb_base_key,aes256_hmac_sha384,
                            <<77,107,230,242,248,0,143,150,231,49,163,248,222,62,88,
                              85,249,44,198,191,189,155,194,...>>},
          principal => ["root"],
          realm => "EXAMPLE.COM",renewuntil => <<"20210628065938Z">>,
          svc_principal => ["host","kdc.example.com"],
          ticket =>
              {'Ticket',5,"EXAMPLE.COM",
                        {'PrincipalName',2,["host","kdc.example.com"]},
                        {'EncryptedData',aes256_hmac_sha384,2,
                                         <<58,53,165,168,144,253,86,97,106,128,221,126,100,142,
                                           37,159,253,...>>}}}}

A simple GSS-API listener/acceptor (using SPNEGO):

    server() ->
        % First, load our keytab from disk
        {ok, KeyTabData} = file:read_file("/etc/krb5.keytab"),
        {ok, KeyTab} = krb_mit_keytab:parse(KeyTabData),

        % Then open our TCP listening socket
        {ok, LSock} = gen_tcp:listen(8082,
            [binary, {active, true}, {packet, line}, {reuseaddr, true}]),
        server(LSock, KeyTab).

    server(LSock, KeyTab) ->
        {ok, Sock} = gen_tcp:accept(LSock),
        % In this example, the client and server send GSS-API tokens to each
        % other base64-encoded on one line per token.
        receive
            {tcp, Sock, Data} ->
                Ret = gss_spnego:accept(base64:decode(Data), #{
                    keytab => KeyTab,
                    chan_bindings => <<0:128/big>>,
                    mutual_auth => true}),
                case Ret of
                    {ok, S0} ->
                        start_server_loop(Sock, S0);
                    {ok, T0, S0} ->
                        gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                        start_server_loop(Sock, S0);
                    {continue, T0, S0} ->
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
                Ret = gss_spnego:continue(base64:decode(Data), S0),
                case Ret of
                    {ok, S0} ->
                        start_server_loop(Sock, S0);
                    {ok, T0, S0} ->
                        gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                        start_server_loop(Sock, S0);
                    {continue, T0, S0} ->
                        gen_tcp:send(Sock, [base64:encode(T0), $\n]),
                        server_continue(Sock, S0)
                end;
            {tcp_closed, Sock} ->
                ok
        end.

    start_server_loop(Sock, S0) ->
        {ok, Peer} = gss_spnego:peer_name(S0),
        {ok, Username} = gss_spnego:translate_name(Peer, ?'id-user-name'),
        io:format("peer username: ~s\n", [Username]),
        server_loop(Sock, S0).

    server_loop(Sock, S0) ->
        receive
            {tcp_closed, Sock} -> ok;
            {tcp, Sock, Data} ->
                {ok, Msg, S1} = gss_spnego:unwrap(base64:decode(Data), S0),
                io:format("<= ~s\n", [Msg]),
                {ok, T, S2} = gss_spnego:wrap(<<"ok\n">>, S1),
                gen_tcp:send(Sock, [base64:encode(T), $\n]),
                case Msg of
                    <<"exit">> ->
                        gen_tcp:close(Sock),
                        ok;
                    _ -> server_loop(Sock, S2)
                end
        end.

Installing
----------

Available on [hex.pm](https://hex.pm/packages/kerlberos)


API docs
--------

[Edoc](https://arekinath.github.io/kerlberos/index.html)
