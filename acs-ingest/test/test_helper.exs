# Mix doesn't start the application in tests (see mix.exs), so start
# the client's dependencies. Tests tagged :acs_local need the acs-local
# cluster; see the README.
#
# assert_receive waits up to a second, rather than ExUnit's 100 ms, as
# a busy run of async tests can take longer than that to start a
# process or a connection.
{:ok, _apps} = Application.ensure_all_started(:fplus)
ExUnit.start(exclude: [:acs_local], assert_receive_timeout: 1000)
