# Contributor Guidelines

Thank you for considering contributing to the amrc-connectivity-stack! We appreciate your help in improving and
maintaining
the project. By following the guidelines below, we can ensure a smooth and collaborative experience for everyone
involved.

## Table of Contents

- [How to Contribute](#how-to-contribute)
    - [Reporting Issues](#reporting-issues)
    - [Submitting Pull Requests](#submitting-pull-requests)
        - [Guidelines For Pull requests](#guidelines-for-pull-requests)
        - [Branch Naming](#branch-naming)
        - [Commit Message Guidelines](#commit-message-guidelines)
    - [Documentation](#documentation)
    - [License](#license)

## How to Contribute

There are several ways you can contribute to the project:

---

### Reporting Issues

If you encounter a bug, have a question, or want to request a feature,
please [open an issue](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack/issues). When reporting an issue,
please include:

- A clear and descriptive title.
- A detailed description of the problem or feature request.
- Steps to reproduce the issue (if applicable).
- Any relevant error messages or screenshots.
- The environment (OS, version, etc.) where the issue occurred.
- Use appropriate labels to categorize the issue (bug, enhancement, etc.).

----

### Submitting Pull Requests

We welcome pull requests for both bug fixes and feature additions. Here’s guidance to consider when creating one:

#### Guidelines for Pull Requests

Before submitting your pull request, ensure that it meets the following criteria:

- **Title and description:** The PR has a descriptive title and includes a clear explanation of the changes and why they
  are necessary.
- **Small, focused changes:** The PR addresses only one issue or adds a single feature.
- **Documentation:** Any necessary documentation (e.g., README, usage docs) has been updated to reflect the changes.
- **Linked issues:** Any related issues are referenced with keywords like Fixes #<issue-number> or Closes #<
  issue-number> to close them automatically when the PR is merged.
- **No merge conflicts:** The branch is up to date with main, and there are no merge conflicts.

#### Branch Naming

For consistency, please use the following naming convention for branches:

initial-branchDescription* (eg: `js-update-config-schema`)

#### Commit Message Guidelines

Good commit messages make it easier for others (and your future self) to understand the history of the project, why
certain changes were made, and how to navigate through the codebase. Here are some guidelines to help you write
effective and meaningful commit messages.

- **Be clear and concise**: A commit message should be easy to understand at a glance.
- **Explain the "why"**: While the code itself shows *what* was changed, the commit message should explain *why* the
  change was necessary.
- **Use the imperative mood**: Treat the message as if it’s giving commands, e.g., "Fix bug in login logic" instead of "
  Fixed bug in login logic."
- **Reference relevant issues**: Include issue numbers when applicable (e.g., `Fixes #42`), which will help to
  automatically close the issue when the PR is merged.

Each commit message should consist of the following:

1. **Subject line (title)**
    - Start with a capital letter.
    - Use the imperative mood (e.g., "Add", "Fix", "Update", "Refactor").
    - **Do not end with a period**.

2. **Body (optional)**
   If the change is non-trivial or needs further explanation, include a body after the subject line. Separate the
   subject and body with a blank line.
    - Explain the motivation for the change: Why is this change necessary? What does it fix or improve?
    - Mention any consequences or side effects.
    - Include relevant issue numbers or references to previous commits.

----

### Documentation

Help us improve our documentation! You can contribute by fixing typos, improving examples, or adding more detailed
explanations.

To contribute:

- Make changes to the appropriate .md files or [docs directory](./docs).
- Open a pull request with your improvements.

### License

By contributing to this project, you agree that your contributions will be licensed under the [MIT licence](LICENSE) of
this
repository.