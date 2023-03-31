<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace Tests\Feature;

    use Tests\TestCase;

    class UserMetaTest extends TestCase
    {
        /** @test */
        public function a_user_meta_refers_to_the_defaults_file_if_it_does_not_exist_in_the_users_meta_column()
        {
            $user = $this->signIn();
            $this->assertEquals(true, $user->meta('new_user'));

            $user->setMeta(['new_user' => false]);
            $this->assertEquals(false, $user->fresh()->meta('new_user'));
        }

        /** @test */
        public function a_user_meta_returns_null_if_it_does_not_exist_in_the_defaults_file_or_the_users_meta()
        {
            $user = $this->signIn();
            $this->assertEquals(null, $user->meta('nonexistent_meta'));
        }

        /** @test */
        public function a_user_can_get_their_meta_via_the_api()
        {
            $this->withoutExceptionHandling();

            $this->signIn();

            $result = json_decode($this->post('/api/user/get-meta', [
                'meta' => 'new_user',
            ])->getContent())->data;

            self::assertEquals(true, $result);
        }

        /** @test */
        public function a_user_can_get_all_meta_via_the_api()
        {
            $this->signIn();
            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;

            self::assertEquals(null, auth()->user()->metadata);
            self::assertEquals(true, $result->new_user->value);

            auth()->user()->setMeta(['new_user' => false]);

            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;

            self::assertEquals(false, $result->new_user->value);
        }

        /** @test */
        public function a_user_can_set_their_meta_via_the_api()
        {
            $this->signIn();
            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;
            self::assertEquals(null, auth()->user()->metadata);
            self::assertEquals(true, $result->new_user->value);

            $this->post('/api/user/set-meta', [
                'revisions' => ['new_user' => false],
            ]);

            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;
            self::assertEquals(false, $result->new_user->value);
        }

        /** @test */
        public function a_user_can_reset_their_meta_to_the_default_value_via_the_api()
        {
            $this->signIn();
            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;
            self::assertEquals(null, auth()->user()->metadata);
            self::assertEquals(true, $result->new_user->value);

            $this->post('/api/user/set-meta', [
                'revisions' => ['new_user' => false],
            ]);

            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;
            self::assertEquals(false, $result->new_user->value);

            $this->post('/api/user/reset-meta', [
                'meta' => 'new_user',
            ]);

            $result = json_decode($this->get('/api/user/get-all-meta')->getContent())->data;
            self::assertEquals(true, $result->new_user->value);
        }
    }
