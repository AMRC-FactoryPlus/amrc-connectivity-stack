# ACS Service Client
# Tests for Kerberos credentials that need no KDC
# Copyright 2026 University of Sheffield

defmodule FPlus.CredentialsTest do
  use ExUnit.Case, async: true

  alias FPlus.Credentials
  alias FPlus.Test.Keytab
  alias FPlus.Test.Secrets

  @moduletag :tmp_dir
  # Failed logins log warnings.
  @moduletag :capture_log

  # A KDC that isn't there: a local port nothing listens on.
  @nowhere [{"127.0.0.1", 9}]

  @password "not-a-real-password"
  @key "not-a-key-0123456789abcdef012345"

  defp realm, do: "TEST-#{System.unique_integer([:positive])}.INVALID"

  defp keytab(dir, principal, realm) do
    Keytab.write!(Path.join(dir, "client.keytab"), [
      %{principal: principal, realm: realm, etype: :aes256_hmac_sha1, key: @key}
    ])
  end

  describe "options" do
    test "need a principal" do
      assert_raise ArgumentError, ~r/principal/, fn -> Credentials.init(password: @password) end
    end

    test "need a realm" do
      assert_raise ArgumentError, ~r/realm/, fn ->
        Credentials.init(principal: "sv1test", password: @password)
      end
    end

    test "need a keytab or a password, not both", %{tmp_dir: dir} do
      principal = "sv1test@#{realm()}"

      assert_raise ArgumentError, fn -> Credentials.init(principal: principal) end

      assert_raise ArgumentError, ~r/not both/, fn ->
        Credentials.init(principal: principal, password: @password, keytab: dir)
      end
    end

    test "a missing keytab stops the process", %{tmp_dir: dir} do
      path = Path.join(dir, "missing.keytab")

      assert {:stop, {:keytab, ^path, :enoent}} =
               Credentials.init(principal: "sv1test@#{realm()}", keytab: path)
    end

    test "a keytab that isn't one stops the process, without its contents", %{tmp_dir: dir} do
      path = Path.join(dir, "corrupt.keytab")
      # The right header, then an entry cut short inside the key.
      File.write!(path, <<5, 2, 0, 0, 0, 200>> <> @key)

      assert {:stop, {:keytab, ^path, reason}} =
               Credentials.init(principal: "sv1test@#{realm()}", keytab: path)

      refute Secrets.contains?(reason, @key)
    end

    test "a keytab without the principal's keys stops the process", %{tmp_dir: dir} do
      realm = realm()
      path = keytab(dir, "someone-else", realm)

      assert {:stop, {:no_keytab_keys, ^path}} =
               Credentials.init(principal: "sv1test@#{realm}", keytab: path)
    end

    test "a keytab with one principal supplies it", %{tmp_dir: dir} do
      realm = realm()
      path = keytab(dir, "sv1test", realm)

      assert {:ok, state, {:continue, :login}} = Credentials.init(keytab: path)
      assert state.principal == [~c"sv1test"]
      assert state.realm == String.to_charlist(realm)
    end

    test "a keytab with several principals needs :principal", %{tmp_dir: dir} do
      realm = realm()

      path =
        Keytab.write!(Path.join(dir, "shared.keytab"), [
          %{principal: "sv1one", realm: realm, etype: :aes256_hmac_sha1, key: @key},
          %{principal: "sv1two", realm: realm, etype: :aes256_hmac_sha1, key: @key}
        ])

      assert_raise ArgumentError, ~r/several principals/, fn -> Credentials.init(keytab: path) end

      assert {:ok, %{principal: [~c"sv1two"]}, _continue} =
               Credentials.init(keytab: path, principal: "sv1two@#{realm}")
    end

    test "a principal can be a service principal", %{tmp_dir: dir} do
      realm = realm()
      path = keytab(dir, "HTTP/svc.test.invalid", realm)

      assert {:ok, _state, {:continue, :login}} =
               Credentials.init(principal: "HTTP/svc.test.invalid@#{realm}", keytab: path)
    end
  end

  describe "before logging in" do
    test "starting doesn't wait for the KDC" do
      {time, {:ok, _pid}} =
        :timer.tc(fn ->
          start_supervised(
            {Credentials, principal: "sv1test@#{realm()}", password: @password, kdc: @nowhere}
          )
        end)

      assert time < 500_000
    end

    test "initiate is unavailable, without waiting" do
      {:ok, pid} =
        start_supervised(
          {Credentials, principal: "sv1test@#{realm()}", password: @password, kdc: @nowhere}
        )

      {time, result} = :timer.tc(fn -> Credentials.initiate(pid, "mqtt", "mqtt.test.invalid") end)

      assert result == {:error, :unavailable}
      assert time < 500_000
      assert %{logged_in: false, expires: nil} = Credentials.status(pid)
    end
  end

  describe "secrets" do
    test "the password isn't in the process's status" do
      {:ok, pid} =
        start_supervised(
          {Credentials, principal: "sv1test@#{realm()}", password: @password, kdc: @nowhere}
        )

      status = :sys.get_status(pid)

      refute Secrets.contains?(status, @password)
      assert inspect(status) =~ "sv1test"
    end

    test "the keytab's keys aren't in the process's status", %{tmp_dir: dir} do
      realm = realm()

      {:ok, pid} =
        start_supervised(
          {Credentials,
           principal: "sv1test@#{realm}", keytab: keytab(dir, "sv1test", realm), kdc: @nowhere}
        )

      refute Secrets.contains?(:sys.get_status(pid), @key)
    end
  end

  test "verify needs a reply token" do
    assert Credentials.verify(:no_context, nil) == {:error, :no_reply_token}
  end
end
