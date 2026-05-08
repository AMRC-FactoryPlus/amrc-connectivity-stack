<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${msg("logoutConfirmTitle")}
    <#elseif section = "form">
        <div class="acs-form">
            <p class="acs-card-description">${msg("logoutConfirmHeader")}</p>
            <form class="acs-form" action="${url.logoutConfirmAction}" method="POST">
                <input type="hidden" name="session_code" value="${logoutConfirm.code}">
                <button class="acs-btn acs-btn-primary acs-btn-block" name="confirmLogout" id="kc-logout" type="submit">
                    ${msg("doLogout")}
                </button>
            </form>
            <#if !logoutConfirm.skipLink && client?? && client.baseUrl?has_content>
                <div class="acs-text-center acs-mt-2">
                    <a href="${client.baseUrl}" class="acs-btn-link">&laquo; ${msg("backToApplication")}</a>
                </div>
            </#if>
        </div>
    </#if>
</@layout.registrationLayout>
