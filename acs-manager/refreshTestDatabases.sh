#
#  Factory+ / AMRC Connectivity Stack (ACS) Manager component
#  Copyright 2023 AMRC
#

#! bin/bash
php artisan migrate:fresh --env=testing && php artisan db:seed --env=testing