# Mix doesn't start the application in tests (see mix.exs), so start
# the client's dependencies. Tests tagged :acs_local need the acs-local
# cluster; see the README.
{:ok, _apps} = Application.ensure_all_started(:fplus)
ExUnit.start(exclude: [:acs_local])
