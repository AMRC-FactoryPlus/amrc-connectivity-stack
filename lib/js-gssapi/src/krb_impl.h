#ifndef NODE_KRB5_IMPL_H
#define NODE_KRB5_IMPL_H

#include <string>
#include <utility>
#include <optional>
#include <variant>
#include <vector>
#include <krb5.h>

struct KrbError
{
    std::string message;
};

using ResultType = std::variant<std::string, KrbError>;

std::string errorString(krb5_context ctx, krb5_error_code error)
{
    const auto *raw = krb5_get_error_message(ctx, error);
    const auto str = std::string(raw) + " (" + std::to_string(error) + ")";
    krb5_free_error_message(ctx, raw);
    return str;
}

struct Krb5Context
{
    Krb5Context() : ctx(nullptr) { error = krb5_init_context(&ctx); }

    Krb5Context(const Krb5Context &) = delete;
    Krb5Context &operator=(const Krb5Context &) = delete;

    ~Krb5Context()
    {
        if (ctx != nullptr) {
            krb5_free_context(ctx);
        }
    }

    krb5_context operator*() { return ctx; }

    krb5_context ctx;
    krb5_error_code error;
};

template<typename Resource, typename FreeFunc, FreeFunc *free_func>
struct Krb5Resource
{
    Krb5Resource(krb5_context context, const std::optional<Resource> &resource)
        : m_ctx(context), m_resource(resource) {}

    ~Krb5Resource()
    {
        if (m_resource) {
            // Little inconsistency here. Some krb5 free functions take the argument by value,
            // others as a pointer. Let's try to handle both
            if constexpr (std::is_convertible_v<FreeFunc,
                                                krb5_error_code (*)(krb5_context, Resource)>) {
                free_func(m_ctx, *m_resource);
            } else if constexpr (std::is_convertible_v<FreeFunc,
                                                       krb5_error_code (*)(krb5_context,
                                                                           Resource *)>) {
                free_func(m_ctx, &*m_resource);
            }
        }
    }

    Krb5Resource(const Krb5Resource &) = delete;
    Krb5Resource &operator=(const Krb5Resource &) = delete;

    Krb5Resource(Krb5Resource &&rhs)
        : m_ctx(rhs.m_ctx), m_resource(rhs.m_resource)
    {
        rhs.m_ctx = nullptr;
        rhs.m_resource.reset();
    }

    // Not used right now, so not implemented. Compiler will tell us if ever needed.
    Krb5Resource &operator=(Krb5Resource &&rhs) = delete;

    Resource &operator*() { return *m_resource; }

    Resource release()
    {
        Resource r = *m_resource;
        m_resource.reset();
        return r;
    }

private:
    krb5_context m_ctx;
    std::optional<Resource> m_resource;
};

using Principal = Krb5Resource<krb5_principal, decltype(krb5_free_principal), krb5_free_principal>;
using UnparsedName = Krb5Resource<char*, decltype(krb5_free_unparsed_name), krb5_free_unparsed_name>;
using Credentials = Krb5Resource<krb5_creds, decltype(krb5_free_creds), krb5_free_creds>;
using Ccache = Krb5Resource<krb5_ccache, decltype(krb5_cc_close), krb5_cc_close>;
using Keytab = Krb5Resource<krb5_keytab, decltype(krb5_kt_close), krb5_kt_close>;

/// The functions in this krb5 namespace have the same signature as
/// the MIT kerberos library, except they don't use out parameters
/// and return an error code. Instead they return a Krb5Resource
/// and throw errors.
namespace krb5 {

    Principal parse_name(krb5_context context, const char *name)
    {
        krb5_principal resource;
        const auto err = krb5_parse_name(context, name, &resource);
        if (err) {
            throw err;
        }
        return Principal(context, resource);
    }

    Principal cc_get_principal(krb5_context context, krb5_ccache cc)
    {
        krb5_principal resource;
        const auto err = krb5_cc_get_principal(context, cc, &resource);
        if (err) {
            throw err;
        }
        return Principal(context, resource);
    }

    UnparsedName unparse_name(krb5_context context, krb5_const_principal princ)
    {
        char *resource = nullptr;
        const auto err = krb5_unparse_name(context, princ, &resource);
        if (err) {
            throw err;
        }
        return UnparsedName(context, resource);
    }

    Credentials get_init_creds_password(krb5_context context,
                                        krb5_principal client,
                                        const char *password,
                                        krb5_get_init_creds_opt *k5_gic_options)
    {
        krb5_creds resource;
        const auto err = krb5_get_init_creds_password(context, &resource, client,
                                                      const_cast<char*>(password), nullptr, nullptr, 0,
                                                      nullptr, k5_gic_options);
        if (err) {
            throw err;
        }
        return Credentials(context, resource);
    }

    Ccache cc_resolve(krb5_context context, const char *name)
    {
        krb5_ccache resource;
        const auto err = krb5_cc_resolve(context, name, &resource);
        if (err) {
            throw err;
        }
        return Ccache(context, resource);
    }

    Keytab kt_resolve(krb5_context context, const char *name)
    {
        krb5_keytab resource;
        const auto err = krb5_kt_resolve(context, name, &resource);
        if (err) {
            throw err;
        }
        return Keytab(context, resource);
    }

}

std::string getDefaultPrincipal(krb5_context ctx, krb5_ccache cache)
{
    Principal principal = krb5::cc_get_principal(ctx, cache);

    UnparsedName name = krb5::unparse_name(ctx, *principal);
    return *name;
}

ResultType kinit(std::string cc_name, std::string princ_name, std::string password)
{
    Krb5Context context;
    if (context.error != 0) {
        return KrbError{"Could not initialize Kerberos library. Error code (" +
               std::to_string(context.error) + ")"};
    }
    try {
        Principal principal = krb5::parse_name(*context, princ_name.data());
        Credentials creds = krb5::get_init_creds_password(*context, *principal, password.data(), nullptr);
        Ccache ccache = krb5::cc_resolve(*context, cc_name.data());
        auto err = krb5_cc_initialize(*context, *ccache, *principal);
        if (err != 0) {
            return KrbError{errorString(*context, err)};
        }
        std::string princ_name = getDefaultPrincipal(*context, *ccache);

        err = krb5_cc_store_cred(*context, *ccache, &*creds);
        if (err != 0) {
            return KrbError{errorString(*context, err)};
        }

        return princ_name;
    } catch (krb5_error_code error) {
        return KrbError{errorString(*context, error)};
    }
}

ResultType kdestroy(std::string cc_name)
{
    Krb5Context context;
    if (context.error != 0) {
        return KrbError{"Could not initialize Kerberos library. Error code (" +
               std::to_string(context.error) + ")"};
    }
    try {
        Ccache ccache = krb5::cc_resolve(*context, cc_name.data());
        const auto krb5_cc = ccache.release();
        const auto err = krb5_cc_destroy(*context, krb5_cc);
        if (err != 0) {
            return KrbError{errorString(*context, err)};
        }
        return std::string();
    } catch (krb5_error_code error) {
        return KrbError{errorString(*context, error)};
    }
}

ResultType verifyCredentials(std::string princ_name, std::string password, std::string keytab_path, std::string server_principal)
{
    Krb5Context context;
    if (context.error != 0) {
        return KrbError{"Could not initialize Kerberos library. Error code (" +
               std::to_string(context.error) + ")"};
    }
    try {
        Principal principal = krb5::parse_name(*context, princ_name.data());
        Credentials creds = krb5::get_init_creds_password(*context, *principal, password.data(), nullptr);

        krb5_verify_init_creds_opt opts;
        krb5_verify_init_creds_opt_init(&opts);

        krb5_verify_init_creds_opt_set_ap_req_nofail(&opts, 1);

        std::optional<Keytab> kt;
        if (!keytab_path.empty()) {
            kt.emplace(krb5::kt_resolve(*context, keytab_path.data()));
        }

        std::optional<Principal> server_princ;
        if (!server_principal.empty()) {
            server_princ.emplace(krb5::parse_name(*context, server_principal.data()));
        }

        const auto err = krb5_verify_init_creds(*context, &*creds,
                                                server_princ ? **server_princ : nullptr,
                                                kt ? **kt : nullptr, nullptr, &opts);
        if (err == 0) {
            return std::string();
        }
        return KrbError{errorString(*context, err)};
    } catch (krb5_error_code err) {
        return KrbError{errorString(*context, err)};
    }
}

#endif
