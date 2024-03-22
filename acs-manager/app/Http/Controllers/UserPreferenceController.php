<?php

    /*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

    use App\Domain\Preferences\Actions\GetAllPreferencesAction;
    use App\Domain\Preferences\Actions\GetPreferenceAction;
    use App\Domain\Preferences\Actions\ResetPreferenceAction;
    use App\Domain\Preferences\Actions\SetPreferenceAction;
    use App\Domain\Preferences\Requests\GetPreferenceRequest;
    use App\Domain\Preferences\Requests\ResetPreferenceRequest;
    use App\Domain\Preferences\Requests\SetPreferenceRequest;
    use App\Domain\Users\Actions\DeleteUserNowAction;
    use App\Domain\Users\Actions\GetUserDetailsAction;
    use App\Domain\Users\Actions\MarkUserForDeletionAction;
    use App\Domain\Users\Actions\UnmarkUserForDeletionAction;
    use App\Domain\Users\Actions\UpdateUserDetailsAction;
    use App\Domain\Users\Requests\PatchUserRequest;
    use App\Domain\Users\Resources\UserResource;
    use Illuminate\Http\Request;

    class UserPreferenceController extends Controller
    {
        /**
         *    Show the user preference page
         */
        public function show(GetUserDetailsAction $getUserDetailsAction)
        {
            return view('preferences.show', [
                'user' => process_view_action($getUserDetailsAction->execute(auth()->user()), UserResource::class),
            ]);
        }

        /**
         *    Update the user's details
         *
         *
         * @return \Illuminate\Contracts\Routing\ResponseFactory|mixed|\Symfony\Component\HttpFoundation\Response
         *
         * @throws \App\Exceptions\ActionDoesNotReturnActionResponseException
         */
        public function update(PatchUserRequest $request, UpdateUserDetailsAction $updateUserDetailsAction)
        {
            return process_action($updateUserDetailsAction->execute($request->first_name, $request->last_name, $request->file('avatar')));
        }

        /**
         *    Gets a user's preference
         *
         * @param  Request  $request
         *
         * @throws \App\Exceptions\ActionDoesNotReturnActionResponseException
         */
        public function getPreference(GetPreferenceRequest $request, GetPreferenceAction $getPreferenceAction)
        {
            return process_action($getPreferenceAction->execute($request->preference));
        }

        /**
         *    Gets all of the user's preferences
         */
        public function getAllPreferences(GetAllPreferencesAction $getAllPreferencesAction)
        {
            return process_action($getAllPreferencesAction->execute());
        }

        /**
         *    Sets a user's preference
         */
        public function setPreference(SetPreferenceRequest $request, SetPreferenceAction $setPreferenceAction)
        {
            return process_action($setPreferenceAction->execute($request->revisions));
        }

        /**
         *    Resets a user's preference to the default value
         */
        public function resetPreference(ResetPreferenceRequest $request, ResetPreferenceAction $resetPreferenceAction)
        {
            return process_action($resetPreferenceAction->execute($request->preference));
        }

        /**
         *    Marks the user for deletion
         */
        public function delete(MarkUserForDeletionAction $markUserForDeletionAction)
        {
            return process_action($markUserForDeletionAction->execute(auth()->user()));
        }

        /**
         *    Undoes the user's deletion
         */
        public function undelete(UnmarkUserForDeletionAction $unmarkUserForDeletionAction)
        {
            return process_action($unmarkUserForDeletionAction->execute(auth()->user()));
        }

        /**
         *    Expedite a deleting account
         */
        public function deleteNow(DeleteUserNowAction $deleteUserNowAction)
        {
            process_action($deleteUserNowAction->execute());
        }
    }
