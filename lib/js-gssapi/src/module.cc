#include "bind.h"

Napi::Object init(Napi::Env env, Napi::Object exports)
{
    exports.Set(Napi::String::New(env, "acceptSecContext"),
                Napi::Function::New(env, acceptSecContext));
    exports.Set(Napi::String::New(env, "initSecContext"), Napi::Function::New(env, initSecContext));
    exports.Set(Napi::String::New(env, "setKeytabPath"), Napi::Function::New(env, setKeytabPath));
    exports.Set(Napi::String::New(env, "GssSecContext"), GssSecContext::init(env));

    exports.Set(Napi::String::New(env, "verifyCredentials"),
                Napi::Function::New(env, verifyCredentials));
    exports.Set(Napi::String::New(env, "kinit"), Napi::Function::New(env, kinit));
    exports.Set(Napi::String::New(env, "kdestroy"), Napi::Function::New(env, kdestroy));
    return exports;
};

NODE_API_MODULE(NODE_GYP_MODULE_NAME, init);
