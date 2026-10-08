# Making a Release

This describes how changes get from a pull request into a release of
ACS.

## Branches

| Branch        | What goes on it                                   | How it changes                            |
|---------------|---------------------------------------------------|-------------------------------------------|
| `dev`         | All work, including fixes. The default branch.    | PRs                                       |
| `feature/xxx` | Work that spans several PRs and is tested as one. | PRs, then merged into `dev` when ready    |
| `main`        | The latest full release.                          | Fast-forwarded when a release is promoted |

```
PRs ──► dev ──tag──► v6.13.0-rc.1
         │
       fixes ──tag──► v6.13.0-rc.2 ──promote──► v6.13.0 ──fast-forward──► main
```

- Release candidates are published from the head of `dev`. A fix for
  an RC is merged into `dev` like any other change, and the next RC is
  published from the new head of `dev`, so it includes everything else
  merged since the last one.
- A full release is tagged on exactly the commit of the RC that was
  accepted. Promoting an RC adds no new code.
- `main` is never committed to directly. It only moves when a release
  is promoted, so it always points at the latest full release.

## Who can do what

Publishing releases and updating `main` are limited by the repository
rulesets to maintainers and admins. Everyone else works through PRs
into `dev` or a feature branch.

Releases are made by publishing a GitHub release. Publishing creates
the tag and triggers `release.yaml`, which builds and pushes every
image and the Helm chart.

## Normal work

Branch from `dev` and open the PR against `dev`. Work that spans
several PRs and needs testing as a whole goes on a `feature/xxx`
branch first; see the [Contributor Guidelines](./contributor-guidelines.md).

## Publishing a release candidate

```sh
git fetch origin
sha=$(git rev-parse origin/dev)
gh release create v6.13.0-rc.1 --target "$sha" --prerelease --generate-notes
```

Pass the commit rather than `--target dev`, so the RC is exactly the
`dev` you checked, even if a PR is merged while you are publishing.

To fix something found in an RC, merge the fix into `dev` and publish
the next RC (`v6.13.0-rc.2`) the same way.

## Promoting an RC to a release

```sh
git fetch origin --tags
sha=$(git rev-parse 'v6.13.0-rc.2^{commit}')
gh release create v6.13.0 --target "$sha" --generate-notes
git push origin "$sha:refs/heads/main"
```

The push to `main` is always a fast-forward, because every RC is a
commit on `dev` and `dev` is never rewound. If the push is rejected,
something has been committed to `main` outside a release; find out
what before going further, and don't force-push.

## Patch releases

A patch release follows the same path: merge the fix into `dev`,
publish `v6.13.1-rc.1` from the head of `dev`, and promote it.

The patch includes everything merged into `dev` since the last
release, not just the fix. If that includes new features, consider
making it a minor release (`v6.14.0`) instead.

## Backing out unstable work

If something merged into `dev` turns out to be unstable, revert it on
`dev`:

```sh
git revert -m 1 <merge-commit>
```

and open a PR with the revert. Don't rewind or force-push `dev` or
`main`. When the work is ready again, revert the revert.

## Test builds of a branch

To get images from a branch without making a release candidate,
publish a pre-release tagged `vX.Y.0-dev.N` with the branch as its
target. These are test builds, not releases, and shouldn't be
installed outside test clusters.

## JS library releases

Libraries under `lib/` are released with tags like
`js/service-client/v2.1.0`, which publish to npm instead of building
ACS. Tag them on `dev`.
