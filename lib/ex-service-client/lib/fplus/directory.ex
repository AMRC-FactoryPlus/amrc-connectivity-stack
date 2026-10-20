# ACS Service Client
# The Directory
# Copyright 2026 University of Sheffield

defmodule FPlus.Directory do
  @moduledoc """
  The Factory+ Directory, through an `FPlus.HTTP` client.
  """

  alias FPlus.HTTP
  alias FPlus.Service

  @doc """
  A service's registration: its URL and Sparkplug device.

  Returns `{:error, :not_found}` if the service isn't registered.
  """
  @spec get_service_info(atom(), String.t()) :: {:ok, map()} | {:error, term()}
  def get_service_info(http, service) do
    case HTTP.request(http, Service.directory(), :get, "v1/service/#{URI.encode(service)}") do
      {:ok, %{status: 200, body: [info]}} when is_map(info) -> {:ok, info}
      {:ok, %{status: 200, body: []}} -> {:error, :not_found}
      {:ok, %{status: 200, body: infos}} when is_list(infos) -> {:error, :several_registrations}
      {:ok, %{status: 404}} -> {:error, :not_found}
      {:ok, %{status: status}} -> {:error, {:status, status}}
      {:error, reason} -> {:error, reason}
    end
  end

  @doc "A service's URL."
  @spec get_service_url(atom(), String.t()) :: {:ok, String.t()} | {:error, term()}
  def get_service_url(http, service) do
    case get_service_info(http, service) do
      {:ok, %{"url" => url}} when is_binary(url) -> {:ok, url}
      {:ok, _info} -> {:error, :no_url}
      {:error, reason} -> {:error, reason}
    end
  end
end
