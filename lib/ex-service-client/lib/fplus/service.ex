# ACS Service Client
# Factory+ service UUIDs
# Copyright 2026 University of Sheffield

defmodule FPlus.Service do
  @moduledoc """
  The UUIDs of the Factory+ services, as in the JS client's `Service`.
  """

  @directory "af4a1d66-e6f7-43c4-8a67-0fa3be2b1cf9"
  @configdb "af15f175-78a0-4e05-97c0-2a0bb82b9f3b"
  @authentication "cab2642a-f7d9-42e5-8845-8f35affe1fd4"
  @command_escalation "78ea7071-24ac-4916-8351-aa3e549d8ccd"
  @mqtt "feb27ba3-bd2c-4916-9269-79a61ebc4a47"

  @doc "The Directory."
  def directory, do: @directory

  @doc "The ConfigDB."
  def configdb, do: @configdb

  @doc "The Auth service."
  def authentication, do: @authentication

  @doc "Command Escalation."
  def command_escalation, do: @command_escalation

  @doc "The MQTT broker."
  def mqtt, do: @mqtt
end
