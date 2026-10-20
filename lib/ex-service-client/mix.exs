# emqtt lists quicer, a QUIC NIF built from Microsoft's msquic with
# cmake, as a hard dependency, but only uses it for MQTT over QUIC, which
# ACS doesn't use. With this set when emqtt compiles, emqtt leaves QUIC
# out, and quicer is stubbed in deps/0. A service that depends on this
# project gets both through it.
System.put_env("BUILD_WITHOUT_QUIC", "1")

defmodule FPlus.MixProject do
  use Mix.Project

  def project do
    [
      app: :fplus,
      version: "0.1.0",
      elixir: "~> 1.20",
      start_permanent: Mix.env() == :prod,
      elixirc_paths: elixirc_paths(Mix.env()),
      deps: deps()
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_env), do: ["lib"]

  def application do
    [
      extra_applications: [:logger]
    ]
  end

  defp deps do
    [
      {:sparkplug_b, path: "../ex-sparkplug"},
      {:kerlberos, path: "../erl-kerlberos", manager: :rebar3},
      {:emqtt, "~> 1.16"},
      {:quicer, "0.2.15", override: true, compile: "true", app: false},
      {:finch, "~> 0.24"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false}
    ]
  end
end
