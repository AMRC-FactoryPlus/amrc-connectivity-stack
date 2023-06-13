# Installation of an Edge cluster

* `helm install sealed-secrets`
* `kubeseal --fetch-cert`
* Push the certificate wherever we are going to push certificates.
* Create repository
* Commit manifests for flux and s-s to repo. It is important
  that the s-s HelmRelease has the same release name and target
  namespace as the manual install.
* Create krbkey for op1flux/CLUSTER.
* Seal username and password and commit to repo (krbkeys should do this).

It is important that this step has completed before continuing or we
lose control of the edge cluster. If this is scripted the script will
need to wait for the krbkeys operator to generate the key and commit it
to git.

* Create `op1flux/CLUSTER` user in ConfigDB/Auth and grant read access
  to the cluster repo.
* Commit GitRepository and Kustomization to repo. GitRepository needs to
  reference sealed secret.
* `git push`
* `flux install`
* As admin, fetch a token from the git server.
* `flux create secret git temp-token --bearer-token=""`
* `flux create source git CLUSTER --secret-ref=temp-token`
* `flux create kustomization CLUSTER --source=GitRepository/CLUSTER`

The last step will update the GitRepository to use the username/password
out of the SealedSecret instead of the token.

* `flux reconcile source git CLUSTER`
* `flux reconcile kustomization CLUSTER`
* `kubectl delete -n flux-system secret/temp-token`
* `flux reconcile source git CLUSTER`

Check that the cluster can still fetch from git without the token.
