#include "bind.h"
#include "gss_impl.h"
#include "krb_impl.h"

static gss_OID_desc _gss_mech_spnego = {6, (void *)"\x2b\x06\x01\x05\x05\x02"}; // 1.3.6.1.5.5.2
static const gss_OID gss_mech_spnego = &_gss_mech_spnego;

Napi::Function GssSecContext::init(Napi::Env env)
{
    return DefineClass(env,
                       "GssSecContext",
                       {
                           InstanceMethod("clientName", &GssSecContext::clientName),
                           InstanceMethod("isComplete", &GssSecContext::isComplete),
                       });
}

gss_OID parseMechanism(const std::string &mech)
{
    if (mech == "krb5") {
        return const_cast<gss_OID>(gss_mech_krb5);
    } else if (mech == "spnego") {
        return gss_mech_spnego;
    } else {
        return GSS_C_NO_OID;
    }
}

GssSecContext::GssSecContext(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<GssSecContext>(info),
      m_ccname(info[0].As<Napi::String>().Utf8Value()),
      m_server_principal(info[1].As<Napi::String>().Utf8Value()),
      m_mech(parseMechanism(info[2].As<Napi::String>().Utf8Value()))
{}

GssSecContext::~GssSecContext()
{
    if (m_ctx != GSS_C_NO_CONTEXT) {
        OM_uint32 minor;
        gss_delete_sec_context(&minor, &m_ctx, GSS_C_NO_BUFFER);
        m_ctx = GSS_C_NO_CONTEXT;
    }
}

Napi::Value GssSecContext::clientName(const Napi::CallbackInfo &info)
{
    return Napi::String::New(info.Env(), m_client_name);
}

Napi::Value GssSecContext::isComplete(const Napi::CallbackInfo &info)
{
    return Napi::Boolean::New(info.Env(), m_is_complete);
}

class GssAsyncWorker : public Napi::AsyncWorker
{
public:
    GssAsyncWorker(GssSecContext *context, std::vector<char> input_token, Napi::Env env)
        : Napi::AsyncWorker(env),
          m_deferred(Napi::Promise::Deferred::New(env)),
          m_context(context),
          m_input_token(input_token)
    {}

    void OnOK() override
    {
        if (m_error.isError()) {
            m_deferred.Reject(Napi::Error::New(Env(), m_error.toString()).Value());
        } else {
            auto vec = new std::vector<char>(m_output_token);
            m_deferred.Resolve(Napi::Buffer<char>::New(
                Env(),
                vec->data(),
                vec->size(),
                [](Napi::Env, void *arg, std::vector<char> *hint) { delete hint; },
                vec));
        }
    }

    Napi::Promise::Deferred m_deferred;

    GssSecContext *m_context;
    const std::vector<char> m_input_token;
    std::vector<char> m_output_token;
    GssError m_error;
};

class InitSecContextWorker : public GssAsyncWorker
{
public:
    using GssAsyncWorker::GssAsyncWorker;

    void Execute() override
    {
        try {
            const auto ccname = m_context->m_ccname;
            const auto server_principal = m_context->m_server_principal;
            const auto mech = m_context->m_mech;
            GssError err;
            if (!ccname.empty()) {
                err.major = gss_krb5_ccache_name(&err.minor, ccname.data(), nullptr);
                if (GSS_ERROR(err.major)) {
                    m_error = err;
                    return;
                }
            }
            m_output_token = initSecContextImpl(
                &m_context->m_ctx, server_principal, mech, m_input_token, m_context->m_is_complete);
        } catch (const GssError &err) {
            m_error = err;
        }
    }
};

class AcceptSecContextWorker : public GssAsyncWorker
{
public:
    using GssAsyncWorker::GssAsyncWorker;

    void Execute() override
    {
        try {
            std::tie(m_output_token, m_client_name) =
                acceptSecContextImpl(&m_context->m_ctx, m_input_token, m_context->m_is_complete);
        } catch (const GssError &err) {
            m_error = err;
        }
    }

    void OnOK() override
    {
        m_context->m_client_name = m_client_name;
        GssAsyncWorker::OnOK();
    }

private:
    std::string m_client_name;
};

// Simple wrapper class which executes a std::function on a worker thread, and either resolves its
// promise with no arguments, or rejects with an error
class SimplePromiseWorker : public Napi::AsyncWorker
{
public:
    SimplePromiseWorker(Napi::Env env, std::function<std::variant<std::string, KrbError>()> func)
        : Napi::AsyncWorker(env), m_deferred(Napi::Promise::Deferred::New(env)), m_func(func)
    {}

    void Execute() override { m_result = m_func(); }
    void OnOK() override
    {
        if (auto err = std::get_if<KrbError>(&m_result)) {
            m_deferred.Reject(Napi::Error::New(Env(), err->message).Value());
        } else {
            m_deferred.Resolve(Napi::String::New(Env(), std::get<std::string>(m_result)));
        }
    }

    Napi::Promise::Deferred m_deferred;
    
    std::function<std::variant<std::string, KrbError>()> m_func;
    std::variant<std::string, KrbError> m_result;
};

Napi::Value acceptSecContext(const Napi::CallbackInfo &info)
{
    if (info.Length() < 2) {
        throw Napi::TypeError::New(info.Env(), "2 arguments expected");
    }

    auto *ctx = Napi::ObjectWrap<GssSecContext>::Unwrap(info[0].As<Napi::Object>());
    auto ab = info[1].As<Napi::Buffer<char>>();
    auto token = std::vector<char>(static_cast<char *>(ab.Data()),
                                   static_cast<char *>(ab.Data()) + ab.ByteLength());

    AcceptSecContextWorker *worker = new AcceptSecContextWorker(ctx, token, info.Env());
    worker->Queue();
    return worker->m_deferred.Promise();
}

Napi::Value initSecContext(const Napi::CallbackInfo &info)
{
    if (info.Length() < 2) {
        throw Napi::TypeError::New(info.Env(), "2 arguments expected");
    }

    auto *ctx = Napi::ObjectWrap<GssSecContext>::Unwrap(info[0].As<Napi::Object>());
    auto ab = info[1].As<Napi::Buffer<char>>();
    auto token = std::vector<char>(static_cast<char *>(ab.Data()),
                                   static_cast<char *>(ab.Data()) + ab.ByteLength());

    InitSecContextWorker *worker = new InitSecContextWorker(ctx, token, info.Env());
    worker->Queue();
    return worker->m_deferred.Promise();
}

Napi::Value setKeytabPath(const Napi::CallbackInfo &info)
{
    if (info.Length() < 1) {
        throw Napi::TypeError::New(info.Env(), "1 argument expected");
    }
    std::string keytab_path(info[0].As<Napi::String>().Utf8Value());
    if (!keytab_path.empty()) {
        gsskrb5_register_acceptor_identity(keytab_path.c_str());
    }
    return info.Env().Undefined();
}

Napi::Value kinit(const Napi::CallbackInfo &info)
{
    if (info.Length() < 3) {
        throw Napi::TypeError::New(info.Env(), "3 arguments expected");
    }
    std::string ccname(info[0].As<Napi::String>().Utf8Value());
    std::string principal(info[1].As<Napi::String>().Utf8Value());
    std::string password(info[2].As<Napi::String>().Utf8Value());
    auto *worker =
        new SimplePromiseWorker(info.Env(), [=]() { return kinit(ccname, principal, password); });
    worker->Queue();
    return worker->m_deferred.Promise();
}

Napi::Value kdestroy(const Napi::CallbackInfo &info)
{
    if (info.Length() < 1) {
        throw Napi::TypeError::New(info.Env(), "1 arguments expected");
    }
    std::string ccname(info[0].As<Napi::String>().Utf8Value());
    auto *worker = new SimplePromiseWorker(info.Env(), [=]() { return kdestroy(ccname); });
    worker->Queue();
    return worker->m_deferred.Promise();
}

Napi::Value verifyCredentials(const Napi::CallbackInfo &info)
{
    if (info.Length() < 4) {
        throw Napi::TypeError::New(info.Env(), "4 arguments expected");
    }
    std::string principal(info[0].As<Napi::String>().Utf8Value());
    std::string password(info[1].As<Napi::String>().Utf8Value());
    std::string keytab(info[2].As<Napi::String>().Utf8Value());
    std::string serverPrincipal(info[3].As<Napi::String>().Utf8Value());

    auto *worker = new SimplePromiseWorker(
        info.Env(), [=]() { return verifyCredentials(principal, password, keytab, serverPrincipal); });
    worker->Queue();
    return worker->m_deferred.Promise();
}
