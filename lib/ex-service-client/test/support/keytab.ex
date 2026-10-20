# ACS Service Client
# Writes keytabs for tests
# Copyright 2026 University of Sheffield

defmodule FPlus.Test.Keytab do
  @moduledoc false

  # An MIT keytab, format 0x0502, which is what krb_mit_keytab reads.
  # Each entry is %{principal: "sv1test", realm: "TEST.INVALID",
  # etype: :aes256_hmac_sha1, key: <<...>>}.

  @etypes %{aes256_hmac_sha1: 18, aes128_hmac_sha1: 17}

  # KRB5_NT_PRINCIPAL
  @name_type 1

  def write!(path, entries) do
    File.write!(path, [<<5, 2>> | Enum.map(entries, &entry/1)])
    path
  end

  defp entry(%{principal: principal, realm: realm, etype: etype, key: key}) do
    components = String.split(principal, "/")

    body =
      IO.iodata_to_binary([
        <<length(components)::16>>,
        counted(realm),
        Enum.map(components, &counted/1),
        # Name type, timestamp, key version, etype.
        <<@name_type::32, 0::32, 1::8, Map.fetch!(@etypes, etype)::16>>,
        counted(key)
      ])

    <<byte_size(body)::32-signed, body::binary>>
  end

  defp counted(data), do: <<byte_size(data)::16, data::binary>>
end
