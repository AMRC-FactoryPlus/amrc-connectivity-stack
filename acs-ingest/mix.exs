defmodule Ingest.MixProject do
  use Mix.Project

  def project do
    [
      app: :acs_ingest,
      version: "0.1.0",
      elixir: "~> 1.20",
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

  # The application reads its configuration from the environment when it
  # starts, so tests start what they need themselves.
  defp aliases do
    [test: "test --no-start"]
  end

  defp deps do
    [
      {:fplus, path: "../lib/ex-service-client"},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false}
    ]
  end
end
