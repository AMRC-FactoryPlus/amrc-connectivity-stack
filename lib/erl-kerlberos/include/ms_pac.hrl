%% kerlberos
%%
%% Copyright 2020 Alex Wilson <alex@uq.edu.au>
%% The University of Queensland
%% All rights reserved.
%%
%% Redistribution and use in source and binary forms, with or without
%% modification, are permitted provided that the following conditions
%% are met:
%% 1. Redistributions of source code must retain the above copyright
%%    notice, this list of conditions and the following disclaimer.
%% 2. Redistributions in binary form must reproduce the above copyright
%%    notice, this list of conditions and the following disclaimer in the
%%    documentation and/or other materials provided with the distribution.
%%
%% THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
%% IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
%% OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
%% IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
%% INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
%% NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
%% DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
%% THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
%% (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
%% THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
%%

-include_lib("msrpce/include/records.hrl").
-include_lib("msrpce/include/types.hrl").


-type user_session_key() :: msrpce:aligned_bin(16, 4).

% MS-PAC section 2.2.1
-type sid_attrs() :: msrpce:bitset(
    ulong(),
    mandatory | default | enabled | owner | resource,
    #{mandatory => 0,
      default   => 1,
      enabled   => 2,
      owner     => 3,
      resource  => 29}).

% MS-PAC section 2.5
-type user_flags() :: msrpce:bitset(
    ulong(),
    guest | no_encrypt | lanman_key | subauth_key | machine | ntlmv2_dc |
    profile | extra_sids | resource_groups,
    #{guest         => 0,
      no_encrypt    => 1,
      lanman_key    => 3,
      subauth_key   => 6,
      machine       => 7,
      ntlmv2_dc     => 8,
      profile       => 10,
      extra_sids    => 5,
      resource_groups => 9}).

% MS-SAMR section 2.2.1.12
-type samr_uac() :: msrpce:bitset_mask(
    ulong(),
    disabled | homedir_req | no_password | temp_dupe | normal | mns_logon |
    interdomain | workstation | server | no_expire_password | auto_locked |
    enc_text_pw_allowed | smartcard_only | delegation_trust | not_delegated |
    des_only | no_preauth | password_expired | delegation_auth_trust |
    no_auth_data | partial_secrets,
    #{disabled              => 16#00000001,
      homedir_req           => 16#00000002,
      no_password           => 16#00000004,
      temp_dupe             => 16#00000008,
      normal                => 16#00000010,
      mns_logon             => 16#00000020,
      interdomain           => 16#00000040,
      workstation           => 16#00000080,
      server                => 16#00000100,
      no_expire_password    => 16#00000200,
      auto_locked           => 16#00000400,
      enc_text_pw_allowed   => 16#00000800,
      smartcard_only        => 16#00001000,
      delegation_trust      => 16#00002000,
      not_delegated         => 16#00004000,
      des_only              => 16#00008000,
      no_preauth            => 16#00010000,
      password_expired      => 16#00020000,
      delegation_auth_trust => 16#00040000,
      no_auth_data          => 16#00080000,
      partial_secrets       => 16#00100000
      }).

-record(group_membership, {
    relative_id     :: ulong(),
    attributes      :: sid_attrs()
    }).

-record(sid_and_attrs, {
    sid             :: pointer(sid()),
    attributes      :: sid_attrs()
    }).

-record(kerb_validation_info, {
    logon_time              :: filetime(),
    logoff_time             :: filetime(),
    kickoff_time            :: filetime(),
    password_last_set       :: filetime(),
    password_can_change     :: filetime(),
    password_must_change    :: filetime(),
    effective_name          :: rpc_unicode_str(),
    full_name               :: rpc_unicode_str(),
    logon_script            :: rpc_unicode_str(),
    profile_path            :: rpc_unicode_str(),
    home_directory          :: rpc_unicode_str(),
    home_directory_drive    :: rpc_unicode_str(),
    logon_count             :: ushort(),
    bad_password_count      :: ushort(),
    user_id                 :: ulong(),
    primary_group_id        :: ulong(),
    group_count             :: ulong(),
    group_ids               :: pointer(varying_array(#group_membership{})),
    user_flags              :: user_flags(),
    user_session_key        :: user_session_key(),
    logon_server            :: rpc_unicode_str(),
    logon_domain_name       :: rpc_unicode_str(),
    logon_domain_id         :: pointer(sid()),
    reserved1               :: fixed_array(2, ulong()),
    user_account_control    :: samr_uac(),
    sub_auth_status         :: ulong(),

    last_successful_ilogon  :: filetime(),
    last_failed_ilogon      :: filetime(),
    failed_ilogon_count     :: ulong(),

    reserved3               :: ulong(),

    sid_count               :: ulong(),
    extra_sids              :: pointer(varying_array(#sid_and_attrs{})),

    resource_group_domain_sid   :: pointer(sid()),
    resource_group_count        :: ulong(),
    resource_groups             :: pointer(varying_array(#group_membership{}))
    }).

-record(kerb_pac_info_buffer, {
    info            :: pointer(#kerb_validation_info{})
    }).

-record(domain_group_membership, {
    domain_id       :: pointer(sid()),
    group_count     :: ulong(),
    group_ids       :: pointer(array(#group_membership{}))
    }).

-record(kerb_pac_device_info, {
    user_id                 :: ulong(),
    primary_group_id        :: ulong(),
    domain_id               :: pointer(sid()),
    group_count             :: ulong(),
    group_ids               :: pointer(array(#group_membership{})),
    sid_count               :: ulong(),
    extra_sids              :: pointer(array(#sid_and_attrs{})),
    domain_group_count      :: ulong(),
    domain_group_ids        :: pointer(array(#domain_group_membership{}))
    }).

-record(kerb_pac_device_buffer, {
    info            :: pointer(#kerb_pac_device_info{})
    }).

-record(pac_unknown, {
    type :: integer(),
    data :: binary()
    }).
-record(pac_client_info, {
    tgt_time :: integer(),
    name :: binary()
    }).
-record(pac_upn_dns, {
    upn :: binary(),
    dns_name :: binary()
    }).
-record(pac_logon_info, {
    info :: #kerb_validation_info{}
    }).
-record(pac_device_info, {
    info :: #kerb_pac_device_info{}
    }).

-record(pac, {
    version :: integer(),
    buffers :: [#pac_unknown{} | #pac_client_info{} | #pac_upn_dns{} |
        #pac_logon_info{} | #pac_device_info{}]
    }).
