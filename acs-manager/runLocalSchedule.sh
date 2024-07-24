#
#  Factory+ / AMRC Connectivity Stack (ACS) Manager component
#  Copyright 2023 AMRC
#

#! bin/bash
php artisan schedule:work &
php artisan queue:listen