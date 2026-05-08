<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <#if realm.password>
            <form id="kc-form-login" class="acs-form" action="${url.loginAction}" method="post" onsubmit="login.disabled = true; return true;">
                <#if !usernameHidden??>
                    <div class="acs-field">
                        <label for="username" class="acs-label">
                            <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                        </label>
                        <input tabindex="2" id="username" class="acs-input<#if messagesPerField.existsError('username','password')> acs-input-error</#if>"
                               name="username" value="${(login.username!'')}" type="text" autofocus autocomplete="username"
                               aria-invalid="<#if messagesPerField.existsError('username','password')>true</#if>"/>
                        <#if messagesPerField.existsError('username','password')>
                            <span id="input-error" class="acs-field-error" aria-live="polite">
                                ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                            </span>
                        </#if>
                    </div>
                </#if>

                <div class="acs-field">
                    <label for="password" class="acs-label">${msg("password")}</label>
                    <div class="acs-input-wrapper">
                        <input tabindex="3" id="password" class="acs-input<#if usernameHidden?? && messagesPerField.existsError('username','password')> acs-input-error</#if>"
                               name="password" type="password" autocomplete="current-password"
                               aria-invalid="<#if usernameHidden?? && messagesPerField.existsError('username','password')>true</#if>"/>
                        <button class="acs-password-toggle" type="button" aria-label="${msg('showPassword')}"
                                aria-controls="password" data-password-toggle tabindex="4"
                                data-icon-show="fa-eye" data-icon-hide="fa-eye-slash"
                                data-label-show="${msg('showPassword')}" data-label-hide="${msg('hidePassword')}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    </div>
                    <#if usernameHidden?? && messagesPerField.existsError('username','password')>
                        <span id="input-error-pwd" class="acs-field-error" aria-live="polite">
                            ${kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc}
                        </span>
                    </#if>
                </div>

                <#if realm.rememberMe && !usernameHidden??>
                    <div class="acs-field">
                        <label class="acs-label" style="display: flex; align-items: center; gap: 0.5rem;">
                            <input tabindex="5" id="rememberMe" name="rememberMe" type="checkbox" <#if login.rememberMe??>checked</#if>>
                            ${msg("rememberMe")}
                        </label>
                    </div>
                </#if>

                <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>

                <button tabindex="7" class="acs-btn acs-btn-primary acs-btn-block" name="login" id="kc-login" type="submit">
                    ${msg("doLogIn")}
                </button>

                <#if realm.resetPasswordAllowed>
                    <div class="acs-text-center acs-mt-2">
                        <a tabindex="6" href="${url.loginResetCredentialsUrl}" class="acs-btn-link">${msg("doForgotPassword")}</a>
                    </div>
                </#if>
            </form>

            <script>
                (function () {
                    var btn = document.querySelector('[data-password-toggle]');
                    if (!btn) return;
                    var input = document.getElementById('password');
                    btn.addEventListener('click', function () {
                        var hidden = input.type === 'password';
                        input.type = hidden ? 'text' : 'password';
                        btn.setAttribute('aria-label',
                            hidden ? btn.dataset.labelHide : btn.dataset.labelShow);
                    });
                })();
            </script>
        </#if>
    <#elseif section = "info">
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div class="acs-text-center acs-muted">
                <span>${msg("noAccount")} <a tabindex="6" href="${url.registrationUrl}" class="acs-btn-link">${msg("doRegister")}</a></span>
            </div>
        </#if>
    <#elseif section = "socialProviders">
        <#if realm.password && social?? && social.providers?? && social.providers?has_content>
            <div class="acs-mt-4">
                <hr style="border: 0; border-top: 1px solid var(--slate-200); margin: 1rem 0;">
                <h2 class="acs-muted" style="font-size: 0.875rem; font-weight: 500; margin: 0 0 0.75rem;">${msg("identity-provider-login-label")}</h2>
                <ul style="list-style: none; padding: 0; margin: 0; display: grid; gap: 0.5rem;">
                    <#list social.providers as p>
                        <li>
                            <a id="social-${p.alias}" href="${p.loginUrl}" class="acs-btn acs-btn-block" style="border: 1px solid var(--slate-200); background: #fff; color: var(--slate-900);">
                                <#if p.iconClasses?has_content><i class="${properties.kcCommonLogoIdP!} ${p.iconClasses!}" aria-hidden="true"></i></#if>
                                <span>${p.displayName!}</span>
                            </a>
                        </li>
                    </#list>
                </ul>
            </div>
        </#if>
    </#if>
</@layout.registrationLayout>
