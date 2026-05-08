<#--
    ACS Keycloak login theme - master layout
    Replaces keycloak.v2 template.ftl wholesale. Keeps the same
    `registrationLayout` macro signature and #nested sections so
    upstream login.ftl, error.ftl etc. continue to work for any pages
    we haven't overridden.
-->
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false showAnotherWayIfPresent=true>
<!DOCTYPE html>
<html lang="${locale.currentLanguageTag!'en'}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
    <meta name="robots" content="noindex, nofollow">
    <title>${msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" href="${url.resourcesPath}/img/favicon.svg" type="image/svg+xml">
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet">
        </#list>
    </#if>
    <#if scripts??>
        <#list scripts as script>
            <script type="text/javascript" src="${script}"></script>
        </#list>
    </#if>
</head>
<body class="acs-body ${bodyClass}">
    <div class="acs-page">
        <div class="acs-card">
            <div class="acs-card-header">
                <div class="acs-brand">
                    <img src="${url.resourcesPath}/img/favicon.svg" alt="ACS">
                    <span class="acs-wordmark">ACS</span>
                </div>
                <h1 class="acs-card-title"><#nested "header"></h1>
            </div>

            <div class="acs-card-content">
                <#-- Top-level message banner. We mirror upstream's gating: don't
                     show "warning" banners that are already attached to a
                     specific field, since the field-level error is clearer. -->
                <#if displayMessage && message?? && (message.type != 'warning' || !messagesPerField.exists('global'))>
                    <div class="acs-alert acs-alert-${message.type}">
                        <span>${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                </#if>

                <#nested "form">

                <#if auth?has_content && auth.showTryAnotherWayLink() && showAnotherWayIfPresent>
                    <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post" class="acs-mt-4">
                        <input type="hidden" name="tryAnotherWay" value="on"/>
                        <button type="submit" class="acs-btn acs-btn-link">${msg("doTryAnotherWay")}</button>
                    </form>
                </#if>

                <#nested "socialProviders">
            </div>

            <#if displayInfo>
                <div class="acs-card-footer">
                    <#nested "info">
                </div>
            </#if>
        </div>
    </div>
</body>
</html>
</#macro>
