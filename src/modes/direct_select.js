/**
 * direct_select模式，由simple_select转化而来
 * direct_select模式支持几何图形的在编辑
 * `DRAG_HANDLER`记录了几何图形在编辑时对应的几种方式，其中扇形默认只修改角度，不对半径进行修改
 * 处于编辑模式时，矩形和三角形`中间点编辑`功能被禁
 */
import createSupplementaryPoints from '../lib/create_supplementary_points';
import constrainFeatureMovement from '../lib/constrain_feature_movement';
import doubleClickZoom from '../lib/double_click_zoom';
import Constants from '../constants';
import CommonSelectors from '../lib/common_selectors';
import moveFeatures from '../lib/move_features';
import createGeoJsonCircle from '../lib/create_geo_json_circle';
import createGeoJSONRectangle from '../lib/create_geo_json_rectangle';
import geoDistance from '../lib/geo_distance';
import * as turf from '@turf/turf';


const { noTarget, isOfMetaType, isInactiveFeature, isShiftDown } = CommonSelectors;
const isVertex = isOfMetaType(Constants.meta.VERTEX);
const isMidpoint = isOfMetaType(Constants.meta.MIDPOINT);

const GEO_JSON_TYPES = Constants.geojsonTypes;

const DRAG_HANDLER = {
    [GEO_JSON_TYPES.CIRCLE]: 'dragCircle',
    [GEO_JSON_TYPES.TRIANGLE]: 'dragVertex',
    [GEO_JSON_TYPES.RECTANGLE]: 'dragRectangle',
    [GEO_JSON_TYPES.SECTOR]: 'dragSector',
    [GEO_JSON_TYPES.ARROW]: 'dragVertex',
    [GEO_JSON_TYPES.BEZIERARROW]: 'dragVertex',
    [GEO_JSON_TYPES.FEATURE]: 'dragVertex',
    [GEO_JSON_TYPES.LINE_STRING]: 'dragVertex',
    [GEO_JSON_TYPES.FEATURE_COLLECTION]: 'dragVertex',
    [GEO_JSON_TYPES.MULTI_PREFIX]: 'dragVertex',
    [GEO_JSON_TYPES.MULTI_LINE_STRING]: 'dragVertex',
    [GEO_JSON_TYPES.MULTI_POLYGON]: 'dragVertex',
};

const DirectSelect = {};

// INTERNAL FUCNTIONS

DirectSelect.fireUpdate = function () {
    this.map.fire(Constants.events.UPDATE, {
        action: Constants.updateActions.CHANGE_COORDINATES,
        features: this.getSelected().map(f => f.toGeoJSON())
    });
};

DirectSelect.fireActionable = function (state) {
    this.setActionableState({
        combineFeatures: false,
        uncombineFeatures: false,
        trash: state.selectedCoordPaths.length > 0
    });
};

DirectSelect.startDragging = function (state, e) {
    this.map.dragPan.disable();
    state.canDragMove = true;
    state.dragMoveLocation = e.lngLat;
    const type = state.feature.properties['_type_'];
    if (type === 'Rectangle') {
        const paths = state.selectedCoordPaths[0];
        const index = + paths.split('.')[1];
        const otherIndex = index >= 2 ? index - 2 : index + 2;
        state.feature.onePoint = state.feature.coordinates[0][otherIndex];
    }
};

DirectSelect.stopDragging = function (state) {
    this.map.dragPan.enable();
    state.dragMoving = false;
    state.canDragMove = false;
    state.dragMoveLocation = null;
};

DirectSelect.onVertex = function (state, e) {
    this.startDragging(state, e);
    const about = e.featureTarget.properties;
    const selectedIndex = state.selectedCoordPaths.indexOf(about.coord_path);
    if (!isShiftDown(e) && selectedIndex === -1) {
        state.selectedCoordPaths = [about.coord_path];
    } else if (isShiftDown(e) && selectedIndex === -1) {
        state.selectedCoordPaths.push(about.coord_path);
    }

    const selectedCoordinates = this.pathsToCoordinates(state.featureId, state.selectedCoordPaths);
    this.setSelectedCoordinates(selectedCoordinates);
};

DirectSelect.onMidpoint = function (state, e) {
    const type = state.feature.properties['_type_'];
    if (type === GEO_JSON_TYPES.RECTANGLE || type === GEO_JSON_TYPES.TRIANGLE) return;
    this.startDragging(state, e);
    const about = e.featureTarget.properties;
    state.feature.addCoordinate(about.coord_path, about.lng, about.lat);
    this.fireUpdate();
    state.selectedCoordPaths = [about.coord_path];
};

DirectSelect.pathsToCoordinates = function (featureId, paths) {
    return paths.map(coord_path => { return { feature_id: featureId, coord_path }; });
};

DirectSelect.onFeature = function (state, e) {
    if (state.selectedCoordPaths.length === 0) this.startDragging(state, e);
    else this.stopDragging(state);
};

DirectSelect.dragFeature = function (state, e, delta) {
    moveFeatures(this.getSelected(), delta);
    state.dragMoveLocation = e.lngLat;
};
//拖动顶点
DirectSelect.dragVertex = function (state, e, delta) {
    const selectedCoords = state.selectedCoordPaths.map(coord_path => state.feature.getCoordinate(coord_path));
    const selectedCoordPoints = selectedCoords.map(coords => ({
        type: Constants.geojsonTypes.FEATURE,
        properties: {},
        geometry: {
            type: Constants.geojsonTypes.POINT,
            coordinates: coords
        }
    }));

    const constrainedDelta = constrainFeatureMovement(selectedCoordPoints, delta);
    for (let i = 0; i < selectedCoords.length; i++) {
        const coord = selectedCoords[i];
        state.feature.updateCoordinate(state.selectedCoordPaths[i], coord[0] + constrainedDelta.lng, coord[1] + constrainedDelta.lat);
    }
};
//拖动circle时
DirectSelect.dragCircle = function (state, e) {
    const { feature } = state;
    if (!feature) return;
    const center = feature.center;
    const radius = geoDistance(center[1], center[0], e.lngLat.lat, e.lngLat.lng);
    const coords = createGeoJsonCircle(center, radius);
    feature.setCoordinates([coords]);
};
//拖动rectangle时
DirectSelect.dragRectangle = function (state, e) {
    const { feature } = state;
    if (!feature) return;
    const startPoint = feature.onePoint;
    const endPoint = [e.lngLat.lng, e.lngLat.lat];
    const coords = createGeoJSONRectangle(startPoint, endPoint);
    feature.setCoordinates([coords]);
};
//拖动扇形时
DirectSelect.dragSector = function (state, e) {
    const { feature } = state;
    if (!feature) return;
    const center = feature.center;
    const pos1 = feature.start;
    let bearing1 = turf.bearing(center, pos1);
    let bearing2 = turf.bearing(center, [e.lngLat.lng, e.lngLat.lat]);
    //计算半径
    let radius = turf.distance(center, pos1);
    //生成扇形坐标
    const sector = turf.sector(center, radius, bearing1, bearing2).geometry.coordinates[0].slice(0, -1);
    feature.setCoordinates([sector]);
};

DirectSelect.clickNoTarget = function () {
    this.changeMode(Constants.modes.SIMPLE_SELECT);
};

DirectSelect.clickInactive = function () {
    this.changeMode(Constants.modes.SIMPLE_SELECT);
};

DirectSelect.clickActiveFeature = function (state) {
    state.selectedCoordPaths = [];
    this.clearSelectedCoordinates();
    state.feature.changed();
};

// EXTERNAL FUNCTIONS

DirectSelect.onSetup = function (opts) {
    const featureId = opts.featureId;
    const feature = this.getFeature(featureId);
    // const featureType = feature.properties['_type_'];
    // if (featureType === Constants.geojsonTypes.CIRCLE) return;
    if (!feature) {
        throw new Error('You must provide a featureId to enter direct_select mode');
    }

    if (feature.type === Constants.geojsonTypes.POINT) {
        throw new TypeError('direct_select mode doesn\'t handle point features');
    }

    const state = {
        featureId,
        feature,
        dragMoveLocation: opts.startPos || null,
        dragMoving: false,
        canDragMove: false,
        selectedCoordPaths: opts.coordPath ? [opts.coordPath] : []
    };

    this.setSelectedCoordinates(this.pathsToCoordinates(featureId, state.selectedCoordPaths));
    this.setSelected(featureId);
    doubleClickZoom.disable(this);

    this.setActionableState({
        trash: true
    });

    return state;
};

DirectSelect.onStop = function () {
    doubleClickZoom.enable(this);
    this.clearSelectedCoordinates();
};

DirectSelect.toDisplayFeatures = function (state, geojson, push) {
    if (state.featureId === geojson.properties.id) {
        geojson.properties.active = Constants.activeStates.ACTIVE;
        push(geojson);
        createSupplementaryPoints(geojson, {
            map: this.map,
            midpoints: true,
            selectedPaths: state.selectedCoordPaths
        }).forEach(push);
    } else {
        geojson.properties.active = Constants.activeStates.INACTIVE;
        push(geojson);
    }
    this.fireActionable(state);
};

DirectSelect.onTrash = function (state) {
    state.selectedCoordPaths.sort().reverse().forEach(id => state.feature.removeCoordinate(id));
    this.map.fire(Constants.events.UPDATE, {
        action: Constants.updateActions.CHANGE_COORDINATES,
        features: this.getSelected().map(f => f.toGeoJSON())
    });
    state.selectedCoordPaths = [];
    this.clearSelectedCoordinates();
    this.fireActionable(state);
    if (state.feature.isValid() === false) {
        this.deleteFeature([state.featureId]);
        this.changeMode(Constants.modes.SIMPLE_SELECT, {});
    }
};

DirectSelect.onMouseMove = function (state, e) {
    // On mousemove that is not a drag, stop vertex movement.
    const isFeature = CommonSelectors.isActiveFeature(e);
    const onVertex = isVertex(e);
    const noCoords = state.selectedCoordPaths.length === 0;
    if (isFeature && noCoords) this.updateUIClasses({ mouse: Constants.cursors.MOVE });
    else if (onVertex && !noCoords) this.updateUIClasses({ mouse: Constants.cursors.MOVE });
    else this.updateUIClasses({ mouse: Constants.cursors.NONE });
    this.stopDragging(state);
};

DirectSelect.onMouseOut = function (state) {
    // As soon as you mouse leaves the canvas, update the feature
    if (state.dragMoving) this.fireUpdate();
};

DirectSelect.onTouchStart = DirectSelect.onMouseDown = function (state, e) {
    if (isVertex(e)) return this.onVertex(state, e);
    if (CommonSelectors.isActiveFeature(e)) return this.onFeature(state, e);
    if (isMidpoint(e)) return this.onMidpoint(state, e);
};

DirectSelect.onDrag = function (state, e) {
    if (state.canDragMove !== true) return;
    state.dragMoving = true;
    e.originalEvent.stopPropagation();

    const delta = {
        lng: e.lngLat.lng - state.dragMoveLocation.lng,
        lat: e.lngLat.lat - state.dragMoveLocation.lat
    };
    const type = state.feature.properties['_type_'];
    if (state.selectedCoordPaths.length > 0) {
        // this.dragVertex(state, e, delta);
        // this.dragRectangle(state, e);
        this[DRAG_HANDLER[type]](state, e, delta);
    } else {
        console.log('2');
        this.dragFeature(state, e, delta);
    }
    state.dragMoveLocation = e.lngLat;
};

DirectSelect.onClick = function (state, e) {
    if (noTarget(e)) return this.clickNoTarget(state, e);
    if (CommonSelectors.isActiveFeature(e)) return this.clickActiveFeature(state, e);
    if (isInactiveFeature(e)) return this.clickInactive(state, e);
    this.stopDragging(state);
};

DirectSelect.onTap = function (state, e) {
    if (noTarget(e)) return this.clickNoTarget(state, e);
    if (CommonSelectors.isActiveFeature(e)) return this.clickActiveFeature(state, e);
    if (isInactiveFeature(e)) return this.clickInactive(state, e);
};

DirectSelect.onTouchEnd = DirectSelect.onMouseUp = function (state) {
    if (state.dragMoving) {
        this.fireUpdate();
    }
    this.stopDragging(state);
};

export default DirectSelect;