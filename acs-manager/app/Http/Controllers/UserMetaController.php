<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

namespace App\Http\Controllers;

use App\Domain\Meta\Actions\GetAllMetaAction;
use App\Domain\Meta\Actions\GetMetaAction;
use App\Domain\Meta\Actions\ResetMetaAction;
use App\Domain\Meta\Actions\SetMetaAction;
use App\Domain\Meta\Requests\GetMetaRequest;
use App\Domain\Meta\Requests\ResetMetaRequest;
use App\Domain\Meta\Requests\SetMetaRequest;
use Illuminate\Http\Request;

class UserMetaController extends Controller
{
    /**
     *    Gets a user's preference
     *
     * @param  Request  $request
     *
     * @throws \App\Exceptions\ActionDoesNotReturnActionResponseException
     */
    public function getMeta(GetMetaRequest $request, GetMetaAction $getMetaAction)
    {
        return process_action($getMetaAction->execute($request->meta));
    }

    /**
     *    Gets all of the user's preferences
     */
    public function getAllMeta(GetAllMetaAction $getAllMetaAction)
    {
        return process_action($getAllMetaAction->execute());
    }

    /**
     *    Sets a user's preference
     */
    public function setMeta(SetMetaRequest $request, SetMetaAction $setMetaAction)
    {
        return process_action($setMetaAction->execute($request->revisions));
    }

    /**
     *    Resets a user's preference to the default value
     */
    public function resetMeta(ResetMetaRequest $request, ResetMetaAction $resetMetaAction)
    {
        return process_action($resetMetaAction->execute($request->meta));
    }
}
