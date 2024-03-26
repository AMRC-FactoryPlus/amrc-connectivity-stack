<?php
/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Manager component
 *  Copyright 2023 AMRC
 */

use App\Exceptions\ActionDoesNotReturnActionResponseException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\Relation;

if (! function_exists('action_error')) {
    function action_error($data, $statusCode = null)
    {
        return [
            'status' => 'error',
            'data' => $data,
            'status_code' => $statusCode,
        ];
    }
}

if (! function_exists('action_fail')) {
    function action_fail($data, $statusCode = null)
    {
        return [
            'status' => 'fail',
            'data' => $data,
            'status_code' => $statusCode,
        ];
    }
}

if (! function_exists('action_success')) {
    function action_success($data = null, $statusCode = 200)
    {
        return [
            'status' => 'success',
            'data' => $data,
            'status_code' => $statusCode,
        ];
    }
}

if (! function_exists('action_redirect')) {
    function action_redirect($data = null)
    {
        return [
            'status' => 'redirect',
            'data' => $data,
            'status_code' => 300,
        ];
    }
}

if (! function_exists('process_action')) {
    /**
     * This function takes the response of the action and either gets or paginates the data and returns the appropriate JSend response to the request. It can also wrap the response in a
     * Resource or ResourceCollection if supplied.
     * If a value is supplied for $injectResourceValues then each item in the returned array (or single item) is modified to add the new property. This can be useful for dynamically setting whether API resources should return some values.
     *
     * @param  null  $resource
     * @param  array  $injectResourceValues
     * @param  null  $paginate
     * @return \Illuminate\Contracts\Routing\ResponseFactory|mixed|\Symfony\Component\HttpFoundation\Response
     *
     * @throws \App\Exceptions\ActionDoesNotReturnActionResponseException
     */
    function process_action(
      $actionResponse,
      $resource = null,
      $injectResourceValues = [],
      $paginate = null
    ) {
        // Ensure the action returned an ActionResponse
        if (! is_array($actionResponse) || count($actionResponse) !== 3 || ! array_key_exists('status', $actionResponse)
          || ! array_key_exists('data', $actionResponse)
        ) {
            throw new ActionDoesNotReturnActionResponseException('The action did not return an ActionResponse.');
        }

        // Return
        switch ($actionResponse['status']) {
            case 'success':
                /**
                 * If we have a pagination request, paginate
                 * If we don't have paginate but we have a collection, get()
                 * Otherwise, return raw
                 */
                do {
                    if ($paginate) {
                        $data = $actionResponse['data']->paginate($paginate);
                        foreach ($data->items() as $item) {
                            $item->fill($injectResourceValues);
                        }
                        break;
                    }

                    if ($actionResponse['data'] instanceof Builder
                      || $actionResponse['data'] instanceof Spatie\QueryBuilder\QueryBuilder
                      || $actionResponse['data'] instanceof Relation) {
                        $data = $actionResponse['data']->get();
                        foreach ($data as $item) {
                            $item->fill($injectResourceValues);
                        }
                        break;
                    }

                    if ($actionResponse['data'] instanceof Laravel\Scout\Builder
                    ) {
                        $data = $actionResponse['data']->get();
                        break;
                    }

                    $data = $actionResponse['data'];
                } while (0);

                if (! $resource) {
                    return jsend_success($data, $actionResponse['status_code'] ?? 200);
                }

                return jsend_success(new $resource($data), $actionResponse['status_code'] ?? 200);

            case 'redirect':

                return $actionResponse['data'];
            default:
                throw new ActionDoesNotReturnActionResponseException('The action returned an unrecognised status.');
        }
    }
}

if (! function_exists('process_action_2')) {
    /**
     * This function takes the response of the action and either gets or paginates the data and returns the appropriate JSend response to the request. It can also wrap the response in a
     * Resource or ResourceCollection if supplied.
     * If a value is supplied for $injectResourceValues then each item in the returned array (or single item) is modified to add the new property. This can be useful for dynamically setting whether API resources should return some values.
     *
     * @return \Illuminate\Contracts\Routing\ResponseFactory|mixed|\Symfony\Component\HttpFoundation\Response
     *
     * @throws \App\Exceptions\ActionDoesNotReturnActionResponseException
     */
    function process_action_2(
        $actionClass,
        $args,
        $resource = null,
        array $injectResourceValues = [],
        $paginate = null,
        $asCollection = false,
        $collectionKey = null,
        $injectCollectionValues = [],
    ) {
        // + Check that the $actionClass has an execute() function.

        // Run the action
        $actionResponse = (new $actionClass)->execute(...$args);

        // Return
        switch ($actionResponse['status']) {
            case 'success':
                /*
                 * If we have a filter request get that
                 * If we have a pagination request, paginate
                 * If we have a raw collection then fill if required but otherwise return
                 * If we don't have paginate but we have a query, get()
                 * Otherwise, return raw
                 */
                do {
                    $data = $actionResponse['data'];

                    if ($paginate && ! request()?->has('raw')) {
                        if ($collectionKey) {
                            $data[$collectionKey] = $data[$collectionKey]->paginate($paginate);
                        } else {
                            $data = $actionResponse['data']->paginate($paginate);
                        }

                        //  Inject $injectResourceValues for each entry
                        foreach (($collectionKey ? $data[$collectionKey]->items() : $data->items()) as $item) {
                            $item->fill($injectResourceValues);
                        }
                        break;
                    }

                    if (($collectionKey ? $actionResponse['data'][$collectionKey] : $actionResponse['data']) instanceof Collection) {
                        $data = $actionResponse['data'];
                        foreach (($collectionKey ? $data[$collectionKey] : $data) as $item) {
                            $item->fill($injectResourceValues);
                        }
                        break;
                    }

                    if ($actionResponse['data'] instanceof Builder || $actionResponse['data'] instanceof Spatie\QueryBuilder\QueryBuilder ||
                        $actionResponse['data'] instanceof Relation) {
                        $data = $actionResponse['data']->get();
                        foreach (($collectionKey ? $data[$collectionKey] : $data) as $item) {
                            $item->fill($injectResourceValues);
                        }
                        break;
                    }

                    if (is_object($actionResponse['data']) && $injectResourceValues !== null && $injectResourceValues !== []) {
                        $actionResponse['data']->fill($injectResourceValues);
                    }
                } while (0);

                // If we have passed $injectCollectionValues then add that to the top level data
                if (count($injectCollectionValues) > 0) {
                    foreach ($injectCollectionValues as $key => $value) {
                        $data->{$key} = $value;
                    }
                }

                if (! $resource) {
                    /* If we don't have a resource then check to see if an Resource exists for this Action in the domain, using the Collection if we're
                       paginating */

                    // Strip the word Action from the end
                    $actionClass = preg_replace('/Action$/', '', $actionClass);

                    if ($paginate || $asCollection || request()?->has('raw')) {
                        $targetResourcePath = str_replace('\\Actions\\', '\\Resources\\', $actionClass) . 'ResourceCollection';
                    } else {
                        $targetResourcePath = str_replace('\\Actions\\', '\\Resources\\', $actionClass) . 'Resource';
                    }

                    // If we've found a matching resource then instantiate it
                    if (class_exists($targetResourcePath)) {
                        // If we have been given the name of a key that should be used to provide the data then use that
                        return jsend_success(new $targetResourcePath($data), $actionResponse['status_code'] ?? 200);
                    }

                    // If one doesn't exist then return raw
                    return jsend_success($data, $actionResponse['status_code'] ?? 200);
                }

                return jsend_success(new $resource($data), $actionResponse['status_code'] ?? 200);

            case 'redirect':

                return $actionResponse['data'];
            default:
                throw new ActionDoesNotReturnActionResponseException('The action returned an unrecognised status.');
        }
    }
}

if (! function_exists('process_view_action')) {
    /**
     * This function takes the response of the action and returns the appropriate value to the controller to pass to the view for initial data. It can also
     * wrap the response in a Resource or ResourceCollection if supplied.
     */
    function process_view_action($actionResponse, $resource = null, $paginate = null, $order = 'created_at,desc')
    {
        // Ensure the action returned an ActionResponse
        if (! is_array($actionResponse) || count($actionResponse) !== 3 || ! array_key_exists('status', $actionResponse)
          || ! array_key_exists('data', $actionResponse)
        ) {
            throw new ActionDoesNotReturnActionResponseException('The action did not return an ActionResponse.');
        }

        /**
         * If we have a pagination request, paginate
         * If we don't have paginate but we have a collection, get()
         * Otherwise, return raw
         */
        [$orderByString, $orderDirectionString] = explode(',', $order);

        $orderDirectionFunction = $orderDirectionString === 'desc' ? 'orderByDesc' : 'orderBy';

        do {
            if ($paginate) {
                $data = $actionResponse['data']->$orderDirectionFunction($orderByString)->paginate($paginate);
                break;
            }

            if ($actionResponse['data'] instanceof Builder
              || $actionResponse['data'] instanceof Spatie\QueryBuilder\QueryBuilder
            ) {
                $data = $actionResponse['data']->$orderDirectionFunction($orderByString)->get();
                break;
            }

            $data = $actionResponse['data'];
        } while (0);

        return $resource ? new $resource($data) : $data;
    }
}
