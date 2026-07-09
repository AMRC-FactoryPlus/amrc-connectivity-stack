#ifndef NODE_KRB5_GSS_IMPL_H
#define NODE_KRB5_GSS_IMPL_H

#include <string>
#include <utility>
#include <vector>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>

struct GssError
{
    OM_uint32 major = 0;
    OM_uint32 minor = 0;

    static std::string errorCodeToString(OM_uint32 err, bool is_minor)
    {
        if (!GSS_ERROR(err)) {
            return "<none>";
        }

        std::string message;

        OM_uint32 unused;
        OM_uint32 msg_id = 0;
        do {
            gss_buffer_desc buf;
            gss_display_status(&unused,
                               err,
                               is_minor ? GSS_C_MECH_CODE : GSS_C_GSS_CODE,
                               GSS_C_NO_OID,
                               &msg_id,
                               &buf);

            if (!message.empty()) {
                message += "; ";
            }
            message.append(std::string(static_cast<const char *>(buf.value), buf.length));

            gss_release_buffer(&unused, &buf);
        } while (msg_id != 0);
        return message;
    }

    std::string toString() const
    {
        return std::to_string(major) + ": " + errorCodeToString(major, false) +
               " (minor: " + std::to_string(minor) + ": " + errorCodeToString(minor, true) + ")";
    }

    bool isError() const { return GSS_ERROR(major) || GSS_ERROR(minor); }
};

struct ScopedBuffer
{
    ScopedBuffer() : m_allocated(true) {}

    ScopedBuffer(const std::vector<char> &contents) : m_allocated(false)
    {
        m_buffer.length = contents.size();
        m_buffer.value = const_cast<char *>(contents.data());
    }

    ~ScopedBuffer()
    {
        if (m_allocated && m_buffer.value != nullptr) {
            OM_uint32 unused;
            gss_release_buffer(&unused, &m_buffer);
        }
    }

    ScopedBuffer(ScopedBuffer &&) = delete;

    std::vector<char> toVector() const
    {
        return std::vector<char>(static_cast<char *>(m_buffer.value),
                                 static_cast<char *>(m_buffer.value) + m_buffer.length);
    }

    gss_buffer_desc m_buffer = GSS_C_EMPTY_BUFFER;
    bool m_allocated;
};

struct ScopedName
{
    ScopedName() {}

    ScopedName(std::string principal, bool is_service)
    {
        gss_buffer_desc service;
        service.length = principal.size();
        service.value = const_cast<char *>(principal.data());
        auto name_type = is_service ? GSS_C_NT_HOSTBASED_SERVICE : GSS_C_NT_USER_NAME;
        GssError error;
        error.major = gss_import_name(&error.minor, &service, name_type, &m_name);
        if (GSS_ERROR(error.major)) {
            throw error;
        }
    }

    ~ScopedName()
    {
        if (m_name != gss_name_t()) {
            OM_uint32 unused;
            gss_release_name(&unused, &m_name);
        }
    }

    ScopedName(ScopedName &&) = delete;

    std::string toString() const
    {
        OM_uint32 unused;
        ScopedBuffer buf;
        gss_display_name(&unused, m_name, &buf.m_buffer, nullptr);
        const auto vec = buf.toVector();
        return std::string(vec.begin(), vec.end());
    };

    gss_name_t m_name = {};
};

std::vector<char> initSecContextImpl(gss_ctx_id_t *ctx,
                                     std::string server_name,
                                     gss_OID mech_type,
                                     std::vector<char> token,
                                     bool &complete)
{
    complete = false;
    ScopedName imported_server(server_name, true);

    ScopedBuffer input(token);
    ScopedBuffer output;

    GssError err;
    /* AMRC fork: upstream also passes GSS_C_DELEG_FLAG here. That
     * makes libkrb5 request a forwarded TGT from the KDC on every
     * context creation; when the client's TGT is not forwardable the
     * KDC refuses ("TGT NOT FORWARDABLE") and the flag is silently
     * dropped, costing one wasted KDC round trip per token. Nothing
     * in Factory+ consumes delegated credentials, so don't ask. */
    err.major = gss_init_sec_context(&err.minor,
                                     GSS_C_NO_CREDENTIAL,
                                     ctx,
                                     imported_server.m_name,
                                     mech_type,
                                     GSS_C_MUTUAL_FLAG | GSS_C_REPLAY_FLAG,
                                     GSS_C_INDEFINITE,
                                     GSS_C_NO_CHANNEL_BINDINGS,
                                     &input.m_buffer,
                                     nullptr,
                                     &output.m_buffer,
                                     nullptr,
                                     nullptr);

    if (GSS_ERROR(err.major)) {
        throw err;
    }

    if (err.major == GSS_S_COMPLETE) {
        complete = true;
    }

    return output.toVector();
}

std::pair<std::vector<char>, std::string>
acceptSecContextImpl(gss_ctx_id_t *ctx, std::vector<char> token, bool &complete)
{
    complete = false;
    ScopedBuffer input(token);
    ScopedBuffer output;

    OM_uint32 ret_flags = 0;
    gss_cred_id_t delegated_cred = GSS_C_NO_CREDENTIAL;

    ScopedName client_name;

    GssError err;
    err.major = gss_accept_sec_context(&err.minor,
                                       ctx,
                                       GSS_C_NO_CREDENTIAL,
                                       &input.m_buffer,
                                       GSS_C_NO_CHANNEL_BINDINGS,
                                       &client_name.m_name,
                                       nullptr,
                                       &output.m_buffer,
                                       &ret_flags,
                                       nullptr,
                                       &delegated_cred);

    if (GSS_ERROR(err.major)) {
        throw err;
    }

    if (err.major == GSS_S_COMPLETE) {
        complete = true;
    }

    return std::pair{output.toVector(), client_name.toString()};
}

#endif
