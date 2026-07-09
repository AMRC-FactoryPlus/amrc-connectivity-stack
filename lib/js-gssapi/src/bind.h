#include <string>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>
#include <krb5.h>
#include <napi.h>

Napi::Value acceptSecContext(const Napi::CallbackInfo &info);
Napi::Value initSecContext(const Napi::CallbackInfo &info);
Napi::Value setKeytabPath(const Napi::CallbackInfo &info);

Napi::Value kinit(const Napi::CallbackInfo &info);
Napi::Value kdestroy(const Napi::CallbackInfo &info);
Napi::Value verifyCredentials(const Napi::CallbackInfo &info);

class GssSecContext : public Napi::ObjectWrap<GssSecContext>
{
public:
    static Napi::Function init(Napi::Env env);

    GssSecContext(const Napi::CallbackInfo &info);

    ~GssSecContext();

    Napi::Value clientName(const Napi::CallbackInfo &info);
    Napi::Value isComplete(const Napi::CallbackInfo &info);

private:
    friend class InitSecContextWorker;
    friend class AcceptSecContextWorker;

    const std::string m_ccname;
    const std::string m_server_principal;
    const gss_OID m_mech;

    gss_ctx_id_t m_ctx = GSS_C_NO_CONTEXT;
    std::string m_client_name;
    bool m_is_complete = false;
};
