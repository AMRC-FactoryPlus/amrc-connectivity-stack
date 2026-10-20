# ACS Service Client
# Checks the kerlberos fork reads KRB5_CONFIG
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

  test "finds the KDC in ACS's krb5.conf", %{tmp_dir: dir} do
    path = Path.join(dir, "krb5.conf")
    File.write!(path, @acs_krb5_conf)
    System.put_env("KRB5_CONFIG", path)

    conf = :krb_realm_conf.configure(~c"ACS.LOCALHOST")

    assert {~c"kdc.factory-plus.svc.cluster.local", 88} in conf.kdc
  end
end
