# ACS Service Client
# Checks the kerlberos fork reads its configuration as MIT Kerberos does
# Copyright 2026 University of Sheffield

defmodule KerlberosForkConfigTest do
  # KRB5_CONFIG is global to the VM.
  use ExUnit.Case, async: false

  @moduletag :tmp_dir

  # A krb5.conf as ACS's Helm template (deploy/templates/identity/
  # krb5-conf.yaml) renders it.
  @acs_krb5_conf """
  [libdefaults]
      default_realm = ACS.LOCALHOST
      dns_canonicalize_hostname = false
      rdns = false
      udp_preference_limit = 1
      spake_preauth_groups = edwards25519

  [domain_realm]
      cluster.local = ACS.LOCALHOST
          acs.localhost = ACS.LOCALHOST

  [realms]
          ACS.LOCALHOST = {
          kdc = kdc.factory-plus.svc.cluster.local
          admin_server = kadmin.factory-plus.svc.cluster.local
          disable_encrypted_timestamp = true
      }
  """

  setup do
    previous = System.get_env("KRB5_CONFIG")

    on_exit(fn ->
      if previous,
        do: System.put_env("KRB5_CONFIG", previous),
        else: System.delete_env("KRB5_CONFIG")
    end)
  end

  defp realm_conf(dir, name, realm, kdc) do
    path = Path.join(dir, name)

    File.write!(path, """
    [libdefaults]
        dns_lookup_kdc = false
    [realms]
        #{realm} = {
            kdc = #{kdc}
        }
    """)

    path
  end

  test "reads every file in KRB5_CONFIG, skipping missing ones", %{tmp_dir: dir} do
    realm = "FORK-TEST.INVALID"
    first = realm_conf(dir, "first.conf", realm, "kdc1.fork-test.invalid:8888")
    second = realm_conf(dir, "second.conf", realm, "kdc2.fork-test.invalid")
    System.put_env("KRB5_CONFIG", Enum.join([Path.join(dir, "missing.conf"), first, second], ":"))

    conf = :krb_realm_conf.configure(String.to_charlist(realm))

    assert {~c"kdc1.fork-test.invalid", 8888} in conf.kdc
    assert {~c"kdc2.fork-test.invalid", 88} in conf.kdc
    assert conf.use_dns == false
  end

  test "uses the default files when KRB5_CONFIG isn't set", %{tmp_dir: dir} do
    realm = "FORK-TEST-UNSET.INVALID"
    _path = realm_conf(dir, "unused.conf", realm, "kdc.fork-test.invalid")
    System.delete_env("KRB5_CONFIG")

    conf = :krb_realm_conf.configure(String.to_charlist(realm))

    refute {~c"kdc.fork-test.invalid", 88} in conf.kdc
  end

  test "finds the KDC in ACS's krb5.conf, and only that one", %{tmp_dir: dir} do
    path = Path.join(dir, "krb5.conf")
    File.write!(path, @acs_krb5_conf)
    System.put_env("KRB5_CONFIG", path)

    conf = :krb_realm_conf.configure(~c"ACS.LOCALHOST")

    assert conf.kdc == [{~c"kdc.factory-plus.svc.cluster.local", 88}]
    assert conf.udp_preference_limit == 1
  end

  # Patch 8. acs-local's cluster DNS answers SRV queries for anything
  # under acs.localhost with Traefik's ports, which kerlberos added to
  # the configured KDC, and then mostly tried instead of it.
  describe "KDCs from DNS" do
    # A process can't trace itself, so another forwards what it sees.
    setup do
      test = self()
      tracer = spawn_link(fn -> forward(test) end)
      # A module that isn't loaded yet has no functions to trace.
      Code.ensure_loaded!(:krb_realm_conf)
      1 = :erlang.trace_pattern({:krb_realm_conf, :lookup_kdcs, 2}, true, [:local])
      :erlang.trace(self(), true, [:call, {:tracer, tracer}])

      on_exit(fn ->
        :erlang.trace_pattern({:krb_realm_conf, :lookup_kdcs, 2}, false, [:local])
      end)
    end

    test "aren't looked up when krb5.conf names one", %{tmp_dir: dir} do
      path = Path.join(dir, "krb5.conf")
      File.write!(path, @acs_krb5_conf)
      System.put_env("KRB5_CONFIG", path)

      :krb_realm_conf.configure(~c"ACS.LOCALHOST")
      refute_receive {:trace, _pid, :call, {:krb_realm_conf, :lookup_kdcs, _args}}, 200
    end

    test "are looked up when it names none", %{tmp_dir: dir} do
      path = Path.join(dir, "krb5.conf")
      File.write!(path, "[libdefaults]\n    default_realm = FORK-TEST-DNS.INVALID\n")
      System.put_env("KRB5_CONFIG", path)

      :krb_realm_conf.configure(~c"FORK-TEST-DNS.INVALID")
      assert_receive {:trace, _pid, :call, {:krb_realm_conf, :lookup_kdcs, _args}}
    end

    defp forward(test) do
      receive do
        message -> send(test, message)
      end

      forward(test)
    end
  end

  # Patch 9. ACS's KDC only listens on TCP, so trying UDP first cost
  # about 10 s for each request.
  describe "udp_preference_limit" do
    # A fake KDC on one port for UDP and TCP, which reports what arrives
    # on each, and never answers. kerlberos also pings each KDC over
    # UDP, with an anonymous request, whatever the limit.
    defp fake_kdc do
      test = self()
      {:ok, udp} = :gen_udp.open(0, [:binary, active: true, ip: {127, 0, 0, 1}])
      {:ok, port} = :inet.port(udp)
      {:ok, listen} = :gen_tcp.listen(port, [:binary, active: false, ip: {127, 0, 0, 1}])

      spawn_link(fn ->
        {:ok, socket} = :gen_tcp.accept(listen)
        {:ok, request} = :gen_tcp.recv(socket, 0)
        send(test, {:tcp, request})
        Process.sleep(:infinity)
      end)

      port
    end

    defp first_request(dir, settings) do
      port = fake_kdc()
      realm = "FORK-TEST-#{System.unique_integer([:positive])}.INVALID"
      path = Path.join(dir, "krb5.conf")

      File.write!(path, """
      [libdefaults]
          dns_lookup_kdc = false
          #{settings}
      [realms]
          #{realm} = {
              kdc = 127.0.0.1:#{port}
          }
      """)

      System.put_env("KRB5_CONFIG", path)
      {:ok, pid} = open_realm(String.to_charlist(realm))
      task = Task.async(fn -> :krb_realm.authenticate(pid, ["nobody"], "unused") end)

      first = first_for(realm)
      Task.shutdown(task, :brutal_kill)
      first
    end

    # Count only this test's login: not kerlberos's pings, and not an
    # earlier test's requests, which are still being retried and reach
    # this test if the OS gave it the same port.
    defp first_for(realm) do
      receive do
        {:tcp, request} ->
          if login?(request, realm), do: :tcp, else: first_for(realm)

        {:udp, _socket, _ip, _port, request} ->
          if login?(request, realm), do: :udp, else: first_for(realm)
      after
        5000 -> :none
      end
    end

    defp login?(request, realm), do: request =~ "nobody" and request =~ realm

    # Other tests open realms with no KDCs, which crash, and kerlberos's
    # supervisor allows no restarts, so its tree restarts under us.
    defp open_realm(realm, tries \\ 50) do
      :krb_realm.open(realm)
    catch
      :exit, _reason when tries > 0 ->
        Process.sleep(20)
        open_realm(realm, tries - 1)
    end

    test "of 1 sends by TCP first", %{tmp_dir: dir} do
      assert first_request(dir, "udp_preference_limit = 1") == :tcp
    end

    # Under the limit a request goes by UDP, as before, but the time it
    # takes depends on the pings, so only the setting is checked here.
    test "defaults to MIT's 1465 bytes, and ignores a value that isn't a number",
         %{tmp_dir: dir} do
      path = Path.join(dir, "krb5.conf")
      System.put_env("KRB5_CONFIG", path)

      for {setting, limit} <- [
            {"", 1465},
            {"udp_preference_limit = lots", 1465},
            {"udp_preference_limit = 0", 0}
          ] do
        File.write!(path, "[libdefaults]\n    dns_lookup_kdc = false\n    #{setting}\n")
        assert :krb_realm_conf.configure(~c"FORK-TEST.INVALID").udp_preference_limit == limit
      end
    end
  end
end
