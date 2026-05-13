<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        ${msg("errorTitle")}
    <#elseif section = "form">
        <div class="acs-form">
            <p class="acs-card-description" id="kc-error-message">${kcSanitize(message.summary)?no_esc}</p>
            <#if skipLink?? && skipLink>
            <#elseif client?? && client.baseUrl?has_content>
                <div class="acs-text-center acs-mt-2">
                    <a id="backToApplication" href="${client.baseUrl}" class="acs-btn-link">
                        <span class="acs-arrow" aria-hidden="true">&#171;</span>
                        ${msg("backToApplication")}
                    </a>
                </div>
            </#if>
        </div>
    </#if>
</@layout.registrationLayout>
