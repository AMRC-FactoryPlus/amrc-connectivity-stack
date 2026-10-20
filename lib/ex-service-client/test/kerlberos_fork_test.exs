# ACS Service Client
# Checks the kerlberos fork keeps secrets out of crash reports
# Copyright 2026 University of Sheffield

defmodule KerlberosForkTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  # The state records of krb_auth_fsm.erl and krb_tkt_grant_fsm.erl,
  # field for field. Record.extract can't read them: they include
  # generated headers. If the records change, format_status/1 no longer
  # matches them and the secrets checks below fail.
  defp auth_fsm(config, key, result),
    do: {:krb_auth_fsm, nil, config, key, nil, nil, nil, result, []}

  defp tkt_grant_fsm(config, key, result),
    do: {:krb_tkt_grant_fsm, nil, config, nil, key, result, []}

  @password "not-a-real-password"
  @keytab [%{principal: [~c"sv1test"], key: {:krb_base_key, :aes256_hmac_sha1, "not-a-key"}}]
  @ticket %{key: {:krb_base_key, :aes256_hmac_sha1, "not-a-session-key"}}

  # Inspect the whole status, as a crash report would.
  defp refute_secrets(status) do
    text = inspect(status, limit: :infinity, printable_limit: :infinity)

    for secret <- ["not-a-real-password", "not-a-key", "not-a-session-key"] do
      refute text =~ secret, "#{secret} survived: #{text}"
    end
  end

  # A function_clause crash puts the function's arguments, here the
  # whole state, into the exit reason.
  defp crash_reason(state),
    do: {:function_clause, [{:krb_auth_fsm, :probe, [:krb, :msg, state], [line: 1]}]}

  test "krb_auth_fsm hides the password, keytab, key and ticket" do
    data =
      auth_fsm(
        %{realm: ~c"ACS.LOCALHOST", secret: @password, keytab: @keytab},
        {:krb_base_key, :aes256_hmac_sha1, "not-a-key"},
        {:ok, @ticket}
      )

    status = :krb_auth_fsm.format_status(%{state: :auth, data: data, reason: crash_reason(data)})

    refute_secrets(status)
    assert elem(status.data, 2).realm == ~c"ACS.LOCALHOST"
    assert status.reason == {:function_clause, [{:krb_auth_fsm, :probe, 3, [line: 1]}]}
  end

  test "krb_tkt_grant_fsm hides the TGT, key and service ticket" do
    data =
      tkt_grant_fsm(
        %{realm: ~c"ACS.LOCALHOST", tgt: @ticket},
        {:krb_base_key, :aes256_hmac_sha1, "not-a-key"},
        {:ok, @ticket}
      )

    status = :krb_tkt_grant_fsm.format_status(%{state: :tgsreq, data: data})

    refute_secrets(status)
    assert elem(status.data, 2).realm == ~c"ACS.LOCALHOST"
  end

  test "krb_realm hides the password, keytab and TGT in the last call" do
    from = {self(), make_ref()}

    for request <- [
          {:authenticate, [~c"sv1test"], @password, %{keytab: @keytab}},
          {:obtain_ticket, @ticket, [~c"mqtt", ~c"mqtt.acs.localhost"], %{}}
        ] do
      status =
        :krb_realm.format_status(%{
          message: {:"$gen_call", from, request},
          reason: {{:badmatch, request}, []}
        })

      refute_secrets(status)
      assert {:"$gen_call", ^from, {_call, _arg, _arg2, _opts}} = status.message
    end
  end

  test "a crash report from a live krb_realm doesn't include the password" do
    # A realm whose KDC is a local port with nothing listening. The
    # crash below happens before kerlberos would contact it.
    realm = ~c"REDACT-#{System.unique_integer([:positive])}.INVALID"

    Application.put_env(:kerlberos, :realms, [
      {realm, [kdc: [{~c"127.0.0.1", 9}], use_dns: false]}
    ])

    {:ok, pid} = :krb_realm.open(realm)
    ref = Process.monitor(pid)

    # Options that aren't a map crash krb_realm in handle_call, with the
    # whole request, password included, in the exit reason.
    log =
      capture_log(fn ->
        catch_exit(:krb_realm.authenticate(pid, [~c"sv1test"], @password, :not_a_map))
        assert_receive {:DOWN, ^ref, :process, ^pid, _reason}
      end)

    assert log =~ "krb_realm"
    refute log =~ @password
  end

  test "a normal exit reason is left alone" do
    assert :krb_redact.reason(:normal) == :normal
    assert :krb_redact.reason({:shutdown, :closed}) == :shutdown
  end
end
