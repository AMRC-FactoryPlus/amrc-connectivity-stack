defmodule Ingest.MixProject do
  use Mix.Project

  def project do
    [
      app: :acs_ingest,
      version: "0.1.0",
      elixir: "~> 1.20",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger],
      mod: {Ingest.Application, []}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_env), do: ["lib"]

  # The application reads its configuration from the environment when it
  # starts, so tests start what they need themselves.
  defp aliases do
    [test: "test --no-start"]
  end

  defp deps do
    [
      {:fplus, path: "../lib/ex-service-client"},
      {:finch, "~> 0.24"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false}
    ]
  end
end
