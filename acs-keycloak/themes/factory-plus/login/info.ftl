<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=false; section>
    <#if section = "header">
        <#if messageHeader??>${messageHeader}<#else>${message.summary}</#if>
    <#elseif section = "form">
        <div class="acs-form">
            <#if message.summary?? && messageHeader??>
                <p class="acs-card-description" id="kc-info-message">${kcSanitize(message.summary)?no_esc}</p>
            </#if>
            <#if requiredActions??>
                <p class="acs-muted">
                    <#list requiredActions>
                        <#items as reqActionItem>
                            ${kcSanitize(advancedMsg("requiredAction.${reqActionItem}"))?no_esc}<#sep>, </#sep>
                        </#items>
                    </#list>
                </p>
            </#if>
            <#if skipLink?? && skipLink>
            <#elseif pageRedirectUri?has_content>
                <div class="acs-text-center acs-mt-2">
                    <a href="${pageRedirectUri}" class="acs-btn-link">&laquo; ${msg("backToApplication")}</a>
                </div>
            <#elseif actionUri?has_content>
                <div class="acs-text-center acs-mt-2">
                    <a href="${actionUri}" class="acs-btn-link">${kcSanitize(msg("proceedWithAction"))?no_esc}</a>
                </div>
            <#elseif client.baseUrl?has_content>
                <div class="acs-text-center acs-mt-2">
                    <a href="${client.baseUrl}" class="acs-btn-link">&laquo; ${msg("backToApplication")}</a>
                </div>
            </#if>
        </div>
    </#if>
</@layout.registrationLayout>
