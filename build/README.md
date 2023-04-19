This is the folder where the Helm repository is built. The build process is done by the GitHub action defined in the .github/workflows folder. The build process is triggered by a new release in the `v*.*.*` format. The build process will build the Helm repository, index it and push it to the `release` branch. The Helm repository is hosted on GitHub pages and can be accessed at https://amrc-factoryplus.github.io/amrc-connectivity-stack/build.

The Helm chart can be added by running the following command:

```bash
helm repo add amrc-connectivity-stack https://amrc-factoryplus.github.io/amrc-connectivity-stack/build
helm repo update
``` 