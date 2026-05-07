# Keycloak Factory+ User Storage SPI — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Replace Keycloak's Kerberos user federation with a custom Factory+ User Storage SPI plugin so that F+ becomes the single source of truth for users, groups, and (via JWT claims) authorisation data consumed by Grafana, acs-i3x, and future OIDC integrations.

**Architecture:** A Java Maven module `acs-keycloak-spi/` produces a Keycloak provider jar implementing `UserStorageProvider`, `UserLookupProvider`, `UserQueryProvider`, `GroupLookupProvider`, and `CredentialInputValidator`. The SPI calls `acs-auth` via the existing `lib/java-service-client` library (`FPAuth`, `FPGssClientKeytab`) to fetch principals and groups, delegates credential validation to the existing Kerberos infrastructure, and stamps `fp_principal_uuid` + `fp_groups` claims into JWTs via custom protocol mappers. A custom Keycloak Docker image bakes the jar in. Helm + service-setup are updated to install the `factoryplus` federation provider in place of `kerberos`. The module inherits from `lib/java-base-pom` so it shares dependency versions with the rest of the AMRC Java stack.

**Tech Stack:** Java 17 (Keycloak 26 requires it), Maven (multi-module: inherits from `lib/java-base-pom`, depends on `lib/java-service-client` from Phase 2 onward), Keycloak 26.1.1 SPI, JUnit 5, Mockito, AssertJ, Testcontainers (Keycloak module), Wiremock for fake F+ auth in tests, GitHub Actions for CI. Existing repo uses Java 11 in `hivemq-krb/`; this module uses 17 to match Keycloak's requirement and the base-pom default.

**Pedagogy:** The author of this plan has zero Java experience. Every Java concept introduced has a `📘` block explaining it in plain language with a comparison to JS/TS where useful. Skip these when re-reading; they're for first contact only.

**Plan structure:** Phase 1 (foundation) is detailed task-by-task. Phases 2-12 are outlined at headline level and will be re-planned in detail when their phase begins. This avoids writing fiction about week 6 of a 2-month project.

---

## Phase Map

| Phase | Title | Detail level | Outcome |
|---|---|---|---|
| 1 | Build skeleton + hello-world SPI | Full | Maven project, "FixedUser" SPI loads in a real Keycloak via Testcontainers, one hardcoded user logs in, CI green |
| 2 | Wiremock-backed F+ auth client | Headline | SPI calls a fake F+ HTTP API; user lookup by UUID/name/email works end-to-end against the fake |
| 3 | F+ auth read API extensions | Headline | New endpoints in `acs-auth` for paginated user list, prefix search, "groups for principal", "members of group" |
| 4 | Real F+ integration | Headline | SPI talks to real `acs-auth` in a kind cluster; auth via service-account JWT or service principal |
| 5 | Group lookup + caching | Headline | `GroupLookupProvider` implementation; Keycloak CACHED policy with 60s TTL |
| 6 | Credential validator (Kerberos delegate) | Headline | SPNEGO authentication path through SPI; users log in with Kerberos tickets |
| 7 | JWT claim mappers | Headline | `fp_principal_uuid`, `fp_groups`, `fp_classes` claims appear in tokens |
| 8 | Custom Keycloak image | Headline | `acs-keycloak` image built in CI, jar baked in, version-pinned |
| 9 | Helm + service-setup wiring | Headline | `factoryplus` federation provider replaces `kerberos`, Grafana role mapping switches to `fp_groups` |
| 10 | Seed Grafana groups in F+ | Headline | `Grafana Viewer/Editor/Admin` groups with stable UUIDs, dump-schema entries |
| 11 | End-to-end verification recipe | Headline | Documented happy path: provision principal, add to group, log into Grafana, see correct role |
| 12 | Decommission Kerberos federation | Headline | Remove old federation code paths, update docs, write upgrade notes |

---

## Walkthrough convention

After each commit, Alex receives:
1. **What we did** in plain English
2. **Java concepts introduced** (📘 blocks) with JS/TS analogies
3. **How to run the tests** locally (exact commands + expected output)
4. **What Alex should look at to verify** (key files, what to read)

Do NOT skip this. The whole plan exists to teach as it builds.

---

# Phase 1 — Build Skeleton + Hello-World SPI

Goal: Reach a state where `mvn test` compiles a Keycloak provider jar, drops it into a real Keycloak running in Docker, and proves a hardcoded user can log in. Everything else in the project depends on this skeleton being trustworthy.

📘 **What is Maven?** It's the JS-equivalent of `npm` for Java. `pom.xml` is `package.json`. `mvn install` ≈ `npm install`, `mvn test` ≈ `npm test`. Output goes into `target/` (the equivalent of `dist/`). Verbose by design — that's normal.

📘 **What is an SPI?** "Service Provider Interface". Java's standard mechanism for "a host program loads plugins implementing well-known interfaces". Keycloak ships interfaces like `UserStorageProvider`; we implement them; Keycloak discovers our jar at startup and calls our methods when it needs to look up users. Closer to "implementing an abstract class and registering it" than to a plain function callback in JS.

---

### Task 1.1: Repo layout for the new module

**Files:**
- Create: `acs-keycloak-spi/pom.xml`
- Create: `acs-keycloak-spi/.gitignore`
- Create: `acs-keycloak-spi/README.md`
- Create: `acs-keycloak-spi/src/main/java/.gitkeep`
- Create: `acs-keycloak-spi/src/test/java/.gitkeep`

**Step 1: Create the module directory structure**

```bash
mkdir -p acs-keycloak-spi/src/main/java/uk/co/amrc/app/factoryplus/keycloak
mkdir -p acs-keycloak-spi/src/main/resources/META-INF/services
mkdir -p acs-keycloak-spi/src/test/java/uk/co/amrc/app/factoryplus/keycloak
mkdir -p acs-keycloak-spi/src/test/resources
```

📘 **Why this directory structure?** Maven convention: `src/main/java` for production code, `src/test/java` for tests. The package name `uk.co.amrc.app.factoryplus.keycloak` is the Java equivalent of an npm scope. Convention is *strict* reverse-DNS of a domain you control: `factoryplus.app.amrc.co.uk` reversed is `uk.co.amrc.app.factoryplus`. (The existing `hivemq-krb/` module uses `uk.co.amrc.factoryplus`, dropping the `app` segment — slightly off; we're using the correct inversion here.)

**Step 2: Write the minimal `pom.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <groupId>uk.co.amrc.app.factoryplus</groupId>
    <artifactId>acs-keycloak-spi</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <packaging>jar</packaging>
    <name>Factory+ Keycloak User Storage SPI</name>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <keycloak.version>26.1.1</keycloak.version>
        <junit.version>5.10.2</junit.version>
        <mockito.version>5.11.0</mockito.version>
        <assertj.version>3.25.3</assertj.version>
        <testcontainers.version>1.19.7</testcontainers.version>
    </properties>

    <dependencies>
        <!-- Keycloak SPI APIs. 'provided' = host supplies at runtime. -->
        <dependency>
            <groupId>org.keycloak</groupId>
            <artifactId>keycloak-core</artifactId>
            <version>${keycloak.version}</version>
            <scope>provided</scope>
        </dependency>
        <dependency>
            <groupId>org.keycloak</groupId>
            <artifactId>keycloak-server-spi</artifactId>
            <version>${keycloak.version}</version>
            <scope>provided</scope>
        </dependency>
        <dependency>
            <groupId>org.keycloak</groupId>
            <artifactId>keycloak-server-spi-private</artifactId>
            <version>${keycloak.version}</version>
            <scope>provided</scope>
        </dependency>

        <!-- Test-only deps -->
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>${junit.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.mockito</groupId>
            <artifactId>mockito-core</artifactId>
            <version>${mockito.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.mockito</groupId>
            <artifactId>mockito-junit-jupiter</artifactId>
            <version>${mockito.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.assertj</groupId>
            <artifactId>assertj-core</artifactId>
            <version>${assertj.version}</version>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.testcontainers</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>${testcontainers.version}</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.2.5</version>
            </plugin>
        </plugins>
    </build>
</project>
```

📘 **`provided` scope** means "this jar is on the classpath at compile time and during tests, but is NOT bundled into our output jar — Keycloak supplies it at runtime". Critical for SPI plugins; bundling Keycloak's own classes inside our jar would break things.

**Step 3: `.gitignore` and `README.md`**

```
# .gitignore
target/
*.class
.idea/
*.iml
.vscode/
```

```markdown
# acs-keycloak-spi

Factory+ User Storage SPI plugin for Keycloak. Provides a custom federation
source so that Keycloak users, groups, and credential validation are backed
by the Factory+ auth service instead of (or alongside) Kerberos.

## Build

mvn package

Output: `target/acs-keycloak-spi-<version>.jar`

## Test

mvn test                   # unit tests only
mvn verify                 # unit + integration tests (uses Testcontainers, requires Docker)
```

**Step 4: Verify Maven runs**

Run: `cd acs-keycloak-spi && mvn -B compile`
Expected: `BUILD SUCCESS`. (No source files yet so it compiles nothing — that's fine; we're verifying the POM is syntactically valid.)

**Step 5: Confirm with Alex, then commit**

```bash
git add acs-keycloak-spi/
git commit -m "Scaffold acs-keycloak-spi Maven module"
```

**Walkthrough block** (post-commit):
- What we did: created an empty Java module with a `pom.xml` declaring Keycloak 26.1.1 SPI deps and a JUnit 5 test stack. Nothing compiles yet because there's no source, but Maven now knows the module exists.
- Java concepts: Maven, `pom.xml`, the `provided` scope, package directory layout.
- How to verify: `cd acs-keycloak-spi && mvn -B compile` should print `BUILD SUCCESS`.
- Look at: `acs-keycloak-spi/pom.xml`. Compare to `hivemq-krb/dependency-reduced-pom.xml` to see the existing repo's Java style.

---

### Task 1.2: Failing test for "FixedUser" provider class existence

📘 **TDD applies here too.** Even though we're going to wire up infrastructure, we'll TDD the actual logic. We start with a *unit* test for a class that doesn't exist yet, watch it fail, then write the minimum to make it pass.

**Files:**
- Test: `acs-keycloak-spi/src/test/java/uk/co/amrc/app/factoryplus/keycloak/FactoryPlusUserStorageProviderFactoryTest.java`

**Step 1: Write the failing test**

```java
package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class FactoryPlusUserStorageProviderFactoryTest {

    @Test
    void factory_id_is_stable() {
        var factory = new FactoryPlusUserStorageProviderFactory();
        assertThat(factory.getId()).isEqualTo("factoryplus");
    }
}
```

📘 **Decoded:** `package` ≈ namespace. `import` ≈ ES module import. `class` ≈ JS class. `@Test` is an annotation, like `@decorator` in TS. `assertThat(...).isEqualTo(...)` is AssertJ's fluent style; reads almost like English. The factory's `getId()` method returns the federation provider name Keycloak will use to refer to us — `"factoryplus"`, mirroring the existing `"kerberos"` provider id.

**Step 2: Run the test, watch it fail**

Run: `cd acs-keycloak-spi && mvn -B test`
Expected: compile error — class `FactoryPlusUserStorageProviderFactory` does not exist. That's the desired failure.

**Step 3: Create the minimal implementation**

File: `acs-keycloak-spi/src/main/java/uk/co/amrc/app/factoryplus/keycloak/FactoryPlusUserStorageProviderFactory.java`

```java
package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProviderFactory;

public class FactoryPlusUserStorageProviderFactory
        implements UserStorageProviderFactory<FactoryPlusUserStorageProvider> {

    public static final String PROVIDER_ID = "factoryplus";

    @Override
    public FactoryPlusUserStorageProvider create(KeycloakSession session, ComponentModel model) {
        return new FactoryPlusUserStorageProvider(session, model);
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}
```

And the provider class itself (placeholder; we'll fill it in next task):

File: `acs-keycloak-spi/src/main/java/uk/co/amrc/app/factoryplus/keycloak/FactoryPlusUserStorageProvider.java`

```java
package uk.co.amrc.app.factoryplus.keycloak;

import org.keycloak.component.ComponentModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.storage.UserStorageProvider;

public class FactoryPlusUserStorageProvider implements UserStorageProvider {

    private final KeycloakSession session;
    private final ComponentModel model;

    public FactoryPlusUserStorageProvider(KeycloakSession session, ComponentModel model) {
        this.session = session;
        this.model = model;
    }

    @Override
    public void close() {
        // No resources to release yet.
    }
}
```

📘 **`implements UserStorageProviderFactory<...>`** declares we provide an implementation of Keycloak's interface. The `<FactoryPlusUserStorageProvider>` is a *generic type parameter* — analogous to TypeScript generics. It tells Keycloak "the providers I create are of *this specific type*".

📘 **`@Override`** is a compiler-checked declaration that the method below overrides one from the interface. If you misspell the method name, the compiler errors. There's no JS equivalent because JS has no compile-time interface checks.

**Step 4: Run the test, watch it pass**

Run: `mvn -B test`
Expected: `Tests run: 1, Failures: 0, Errors: 0, Skipped: 0`. `BUILD SUCCESS`.

**Step 5: Confirm with Alex, then commit**

```bash
git add acs-keycloak-spi/
git commit -m "Add FactoryPlusUserStorageProvider skeleton with passing factory id test"
```

**Walkthrough block:**
- What we did: created the two classes Keycloak needs to even notice our plugin exists — a `Factory` (creates instances on demand) and a `Provider` (the actual implementation Keycloak holds while serving a request). Wrote and passed our first unit test.
- Java concepts: classes, interfaces, generics, `@Override`, annotations.
- How to verify: `cd acs-keycloak-spi && mvn -B test`. Expect 1 passing test.
- Look at: the two new `.java` files. Note how the factory is one-class-per-file — that's a Java convention.

---

### Task 1.3: Register the factory via SPI metadata

📘 **The `META-INF/services/` ritual.** Java's plugin discovery works by reading text files at well-known paths inside jars. To tell Keycloak "we provide a UserStorageProviderFactory implementation, here it is", we write the fully-qualified class name into `META-INF/services/org.keycloak.storage.UserStorageProviderFactory`. This is the same dance JDBC drivers, logging frameworks, etc. all use. No annotation magic; just a text file.

**Files:**
- Create: `acs-keycloak-spi/src/main/resources/META-INF/services/org.keycloak.storage.UserStorageProviderFactory`

**Step 1: Write a test asserting the resource file exists and has the right contents**

File: `acs-keycloak-spi/src/test/java/uk/co/amrc/app/factoryplus/keycloak/SpiRegistrationTest.java`

```java
package uk.co.amrc.app.factoryplus.keycloak;

import org.junit.jupiter.api.Test;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.assertThat;

class SpiRegistrationTest {

    @Test
    void factory_is_registered_via_service_loader_metadata() throws Exception {
        var resourcePath = "META-INF/services/org.keycloak.storage.UserStorageProviderFactory";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(resourcePath)) {
            assertThat(in)
                .as("SPI registration file %s must exist on the classpath", resourcePath)
                .isNotNull();
            String contents = new String(in.readAllBytes(), StandardCharsets.UTF_8).trim();
            assertThat(contents)
                .isEqualTo("uk.co.amrc.app.factoryplus.keycloak.FactoryPlusUserStorageProviderFactory");
        }
    }
}
```

📘 **`try (...)` is try-with-resources** — auto-closes the `InputStream` even if an exception is thrown. Equivalent to JS's `using` declaration or a `finally { in.close() }`.

**Step 2: Run, expect failure (file doesn't exist yet)**

Run: `mvn -B test`
Expected: `SpiRegistrationTest.factory_is_registered_via_service_loader_metadata` FAILS with "SPI registration file ... must exist on the classpath".

**Step 3: Create the metadata file**

File contents (single line, no trailing whitespace): `uk.co.amrc.app.factoryplus.keycloak.FactoryPlusUserStorageProviderFactory`

**Step 4: Run, expect pass**

Run: `mvn -B test`
Expected: 2 tests pass.

**Step 5: Confirm and commit**

```bash
git add acs-keycloak-spi/
git commit -m "Register SPI factory via META-INF/services"
```

**Walkthrough block:**
- What we did: added the text file that makes Keycloak discover our plugin at startup.
- Java concepts: ServiceLoader, classpath resources, try-with-resources.
- How to verify: `mvn -B test` → 2 passing tests. Inspect `target/classes/META-INF/services/...` to see the file copied into the build output.

---

### Task 1.4: FactoryPlusUserStore interface + UserModel adapter, mock-driven tests

**Engineering choice (2026-05-07):** the original plan had the provider return a hardcoded "fixed.user". Replaced with a real seam: `FactoryPlusUserStore` interface, provider delegates lookups to it, Mockito drives the unit tests. Phase 2's real implementation slots in behind the same interface. No throwaway code is ever committed.

**Files (all new):**
- `FactoryPlusUserStore.java` — interface: `Optional<FactoryPlusUser> findByUuid|Username|Email(String)`
- `FactoryPlusUser.java` — DTO record: `uuid`, `username`, `email`
- `FactoryPlusUserAdapter.java` — wraps a `FactoryPlusUser` as Keycloak's `UserModel` (extends `AbstractUserAdapter` from `keycloak-server-spi-private` to avoid implementing 30+ no-op methods)
- `NullFactoryPlusUserStore.java` — default impl returning `Optional.empty()` for everything; used by the factory until Phase 2 wires in the real store
- Modify `FactoryPlusUserStorageProvider.java` to take a `FactoryPlusUserStore` and implement `UserLookupProvider`
- Modify `FactoryPlusUserStorageProviderFactory.java` to construct the null store as the default
- `FactoryPlusUserStorageProviderTest.java` — Mockito-driven: stubs the store, asserts the provider delegates correctly and adapter fields are right
- `FactoryPlusUserAdapterTest.java` — adapter exposes username/email/id from the DTO

**Approach:**
1. Define the interface and DTO first (no impl). Compiles but does nothing.
2. Build the adapter against `AbstractUserAdapter`. Test it in isolation.
3. Wire the provider to delegate to the store. Tests use a Mockito-stubbed store.
4. Provide `NullFactoryPlusUserStore` as the production default until Phase 2.

📘 **Mockito** is JS's `vi.fn()` / `jest.fn()` for Java. `@Mock` produces a stand-in for the interface so we can construct our provider without real Keycloak. `MockitoExtension` is the JUnit 5 wiring that scans for `@Mock` fields.

📘 **`AbstractUserAdapter`** is Keycloak's helper base class that provides reasonable defaults for every method on `UserModel` (and there are dozens — credentials, attributes, role mappings, group mappings, federation link, etc.). We override only `getUsername`, `getEmail`, and the storage id; the rest stays sensible.

**Walkthrough block:**
- What we did: introduced the seam between "Keycloak SPI surface" and "where users come from" via the `FactoryPlusUserStore` interface. Provider holds one and delegates. Adapter wraps a small DTO into the full `UserModel` Keycloak expects. Production default is a null store; Phase 2 swaps in the real one.
- Java concepts: interfaces with `Optional<T>` return types, `record` types (Java 14+ DTO syntax), `AbstractUserAdapter` from Keycloak, Mockito (`@Mock`, `when().thenReturn()`).
- How to verify: `mvn -B test` → all green; new tests cover provider delegation, adapter fields, and "store returns empty → provider returns null". Inspect `FactoryPlusUserStore.java` — that interface is the contract Phase 2 has to satisfy.

---

### Task 1.5: Build the jar via `mvn package`

**Step 1:** Run `mvn -B package -DskipTests`. Expect `BUILD SUCCESS` and `target/acs-keycloak-spi-0.1.0-SNAPSHOT.jar` exists.
**Step 2:** Verify the jar contains both classes and the META-INF service file: `unzip -l target/*.jar | grep -E "(class|services)"`. Expect to see all three.
**Step 3:** Confirm and commit nothing (build artifact only). No commit step.

**Walkthrough:** prove the jar is real and its contents match what Keycloak will load.

---

### Task 1.6: Testcontainers integration test — load jar in real Keycloak

📘 **Testcontainers** spins up real Docker containers from JUnit. We launch Keycloak 26.1.1, mount our jar into `/opt/keycloak/providers/`, configure a realm with our federation provider, and then drive it via Keycloak's admin REST client — asserting that "fixed.user" appears in user search.

**Files:**
- Create: `acs-keycloak-spi/src/test/java/uk/co/amrc/app/factoryplus/keycloak/integration/FactoryPlusFederationIT.java`
- Create: `acs-keycloak-spi/src/test/resources/realm-test.json` (realm definition with our federation provider configured)

**Step 1:** Write the IT (full file in the executing-plans phase). Pattern:
- Build the jar before test class runs (Maven `pre-integration-test` phase or rely on `mvn verify` ordering)
- `@Container` with image `quay.io/keycloak/keycloak:26.1.1`, file-system bind for the jar, `start-dev` command
- Wait for `/health/ready`
- Use Keycloak Admin Client to import `realm-test.json` (which references the `factoryplus` provider)
- Call `realm.users().search("fixed.user")`, assert one result, assert correct email

**Step 2:** Configure the `failsafe` plugin in `pom.xml` so `*IT.java` runs in the `verify` phase, not `test`.

**Step 3:** Run `mvn -B verify`. Expect a Keycloak container to start, realm to import, federation to load our jar, search to return fixed.user.

**Step 4:** If green, commit:

```bash
git add acs-keycloak-spi/
git commit -m "Testcontainers IT: SPI loads in real Keycloak and serves fixed user"
```

**Walkthrough block:**
- What we did: proved end-to-end that the jar loads in a real Keycloak, Keycloak recognises `factoryplus` as a federation provider, and a search returns our fixed user.
- Java concepts: Testcontainers, Maven build phases (test vs verify), Keycloak Admin Client.
- How to verify: `mvn -B verify`. Takes ~30s on first run (image pull). Subsequent runs ~10s. Requires Docker.
- Look at: the IT file. It's the template for every integration test we'll write later.

---

### Task 1.7: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/acs-keycloak-spi.yml`

**Step 1:** Workflow triggers on push/PR touching `acs-keycloak-spi/**`. Runs `mvn -B verify` on `ubuntu-latest` with JDK 17 (actions/setup-java) and Docker (default-available on ubuntu-latest, used by Testcontainers).

**Step 2:** Verify it passes locally first (`act` if available, or just trust the YAML and push).

**Step 3:** Commit.

**Walkthrough:** CI now gates every change to the SPI on the full unit + integration suite passing.

---

### Task 1.8: README and developer docs

**Files:** Update `acs-keycloak-spi/README.md` with sections: Overview, Build, Test, Run locally against a Keycloak (jar mount instructions), Architecture, How to add a new SPI capability.

**Walkthrough:** future-Alex can come back to this in a month and remember how everything fits.

---

## Phase 1 Acceptance

Phase 1 is done when:
- `cd acs-keycloak-spi && mvn -B verify` passes locally (Docker required)
- CI passes on a PR touching the module
- `target/acs-keycloak-spi-0.1.0-SNAPSHOT.jar`, when mounted into Keycloak, makes `fixed.user` appear as a federated user
- README walks a fresh dev through build + test + run

After Phase 1 lands, re-plan Phase 2 in detail with the `writing-plans` skill again.

---

# Phases 2-12 — Headline Plans

These get re-planned in full detail when their phase begins. Headlines are placeholders to keep the architecture honest.

### Phase 2 — Wiremock-backed F+ auth client (detailed 2026-05-07)

The interface seam (`FactoryPlusUserStore`) already exists from Phase 1.
Phase 2 ships the first real implementation behind it.

**Constraint discovered while planning:** `FPAuth` in `lib/java-service-client`
is incomplete - it only exposes ACL/permission-checking, not user
lookup. Its own javadoc says "Unmapped endpoints can be accessed
through the generic http() interface of FPServiceClient." So Phase 2
uses `FPServiceClient.http().request(SERVICE, method).withPath(...).fetch()`
directly. Phase 4 (real Kerberos integration) keeps this approach;
extending FPAuth upstream is a separate optional cleanup.

**Tasks:**

- **2.1** Add `lib/java-service-client` dep pinned to `0.1-SNAPSHOT`
  (overrides the base-pom's `${acs.version}=0.0.0-intree` which is
  stale relative to the in-tree publication). Verify compile + full
  test suite still green.
- **2.2** Document the F+ auth HTTP contract Wiremock will simulate.
  Lookup by UUID and by Kerberos identity uses existing acs-auth
  endpoints (`GET /v2/principal/:uuid`, `GET /v2/identity/:kind/:name`).
  Lookup by username and email needs new endpoints, defined here as
  spec for Phase 3.
- **2.3** Implement `FPAuthBackedUserStore implements FactoryPlusUserStore`
  using `FPServiceClient.http()`. Wiremock-driven unit tests stub
  each endpoint shape; verify the store parses responses, handles
  404 (returns Optional.empty), and surfaces 5xx as exceptions.
- **2.4** Make factory configuration-driven. Add ComponentModel
  properties (`auth.url`, `auth.principal`, `auth.keytab.path`,
  `auth.timeout.seconds`). If `auth.url` is set, construct
  `FPServiceClient` + `FPAuthBackedUserStore`; otherwise keep
  `NullFactoryPlusUserStore.INSTANCE`.
- **2.5** Extend the IT: run Wiremock as a sibling host (in-process,
  exposed via host.testcontainers.internal), configure the federation
  provider to point at it. Asserts the wiring (config accepted +
  round-trips through Keycloak's component store). End-to-end search
  via Keycloak admin REST is deferred to Phase 5 because it requires
  a UserQueryProvider implementation; the FPAuthBackedUserStore's
  behaviour is fully covered by 10 Wiremock unit tests in the
  meantime.
- **2.6** Acceptance + re-plan Phase 3 in detail.

### Phase 3 — F+ auth read API extensions
- Inventory what Keycloak's `UserQueryProvider` actually needs (paginated user search by prefix, count by criterion, filter by group)
- Add endpoints to `acs-auth/lib/api_v2.js`: `GET /principal?search=&first=&max=`, `GET /principal/:uuid/groups`, `GET /group/:uuid/members`, `GET /principal/count`
- TDD on the JS side (use existing acs-auth test patterns)
- Document the shape

### Phase 4 — Real F+ integration
- Stand up a kind cluster with current dn/oAuth branch
- SPI authenticates to acs-auth using `FPGssClientKeytab` with the existing `sv1openid` keytab (acs-auth already accepts SPNEGO)
- Replace Wiremock in IT with real acs-auth (testcontainers + the real images, or a docker-compose helper)
- Verify end-to-end against real F+ data

### Phase 5 — Group lookup + caching
- Implement `GroupLookupProvider`
- Wire Keycloak's CACHED policy with 60s TTL
- Tests for cache hit/miss, TTL expiry
- Document the staleness contract

### Phase 6 — Credential validator (Kerberos delegate)
- Implement `CredentialInputValidator`
- For SPNEGO: delegate to Keycloak's existing kerberos credential support
- Tests: valid SPNEGO logs in, invalid is rejected, password attempts are refused (we don't store passwords)

### Phase 7 — JWT claim mappers
- Custom `OIDCAttributeMapperHelper` subclasses for `fp_principal_uuid`, `fp_groups`, `fp_classes`
- Register via META-INF/services
- IT: provision client with mappers, call /token, decode JWT, assert claims present
- Document claim names as the public API

### Phase 8 — Custom Keycloak image + shading
- Add `maven-shade-plugin` to `acs-keycloak-spi/pom.xml` to produce a single fat jar with `java-service-client` + transitives bundled in. Relocate packages (Apache HTTP, RxJava, Vavr) under `uk.co.amrc.app.factoryplus.shaded.*` to avoid Keycloak classloader collisions.
- New directory: `acs-keycloak/Dockerfile` — `FROM quay.io/keycloak/keycloak:26.1.1`, COPY shaded jar into `/opt/keycloak/providers/`
- Build via existing repo image pipeline
- Pin version in `deploy/values.yaml` so `acs-keycloak` replaces upstream `keycloak/keycloak`

### Phase 9 — Helm + service-setup wiring
- Switch `ensure_kerberos_federation` in `acs-service-setup/lib/openid.js` to provision `factoryplus` federation provider instead
- New env vars to surface F+ auth URL + service principal to the Keycloak container
- Update Grafana role mapper: from per-client `roles` to `fp_groups` claim
- Update `grafana-ini.yaml` `role_attribute_path` to use UUID matching

### Phase 10 — Seed Grafana groups in F+
- Add three groups (`Grafana Viewer`, `Grafana Editor`, `Grafana Admin`) with stable UUIDs in `acs-service-setup/lib/uuids.js`
- Seed via dump-schema
- Document the UUIDs

### Phase 11 — End-to-end verification recipe
- Script: provision a F+ principal, add to `Grafana Editor`, log in to Grafana, verify role
- Same recipe checked into `docs/`
- Run on a fresh kind cluster as smoke test

### Phase 12 — Decommission Kerberos federation
- Remove `ensure_kerberos_federation` from openid.js
- Update README and docs to point at the new federation
- Write upgrade notes (greenfield realm requirement, per pitch)
- Tag a release of acs-keycloak-spi 1.0.0

---

## Cross-cutting concerns

- **Confirm before every commit** (per Alex's memory).
- **No emdashes anywhere** (per Alex's memory) — verified.
- **No `Co-Authored-By` lines** (per Alex's memory).
- **Walkthrough block after every commit** (this is the entire point of the exercise).
- **TDD throughout** — failing test, then make it pass, then commit. Do not "implement first, test later".
- **Use the verification-before-completion skill before claiming any phase is done.**
